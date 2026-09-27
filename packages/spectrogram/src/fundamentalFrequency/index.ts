import { type FourierMode } from '@musetric/fft';
import { createFourierCell } from '@musetric/fft/gpu';
import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { createPitchParamsCell } from './params.js';
import { createPitchPipelines } from './pipeline.js';
import {
  createPitchSchedule,
  type PitchFrameRange,
  type PitchPlan,
  type PitchSampleRange,
} from './schedule.es.js';
import { createPitchSettings, type PitchSettings } from './settings.es.js';
import {
  createPitchBindGroupsCell,
  createPitchBuffersCell,
  createPitchLineCell,
  pitchSlotBytes,
} from './state.js';

const workgroupSize = 64;

const frameCountOf = (settings: PitchSettings, length: number): number =>
  length > 0 ? Math.floor((length - 1) / settings.hop) + 1 : 0;

type SpanUpload = {
  plan: PitchPlan;
  samples: Float32Array;
  availableSamples: number;
};

const uploadSpans = (
  device: GPUDevice,
  target: GPUBuffer,
  upload: SpanUpload,
): void => {
  const { plan, samples, availableSamples } = upload;
  const last = plan.spans.at(-1);
  if (!last) {
    return;
  }
  const staging = new Float32Array(last.spanOffset + last.length);
  const end = Math.min(samples.length, availableSamples);
  for (const span of plan.spans) {
    const from = Math.max(0, span.sampleStart);
    const to = Math.min(end, span.sampleStart + span.length);
    if (to > from) {
      staging.set(
        samples.subarray(from, to),
        span.spanOffset + from - span.sampleStart,
      );
    }
  }
  device.queue.writeBuffer(target, 0, staging);
};

const uploadSlots = (
  device: GPUDevice,
  target: GPUBuffer,
  plan: PitchPlan,
): void => {
  if (plan.slots.length === 0) {
    return;
  }
  const table = new Int32Array((plan.slots.length * pitchSlotBytes) / 4);
  plan.slots.forEach((slot, index) => {
    table[index * 4] = slot.frame;
    table[index * 4 + 1] = slot.spanOffset;
    table[index * 4 + 2] = slot.predecessor;
    table[index * 4 + 3] = slot.observe ? 1 : 0;
  });
  device.queue.writeBuffer(target, 0, table);
};

export type PitchProjection = {
  baseColumn: number;
  baseSlot: number;
};

export type PitchPrepareInput = {
  samples: Float32Array;
  projection: PitchProjection;
  trackProgress: number;
  truncated: boolean;
  invalidations: readonly PitchSampleRange[];
};

export type PitchStage = {
  label: string;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export type SpectrogramFundamentalFrequency = {
  settings: PitchSettings;
  lineBuffer: GPUBuffer;
  decodedBuffer: GPUBuffer;
  prepare: (input: PitchPrepareInput) => void;
  stages: readonly PitchStage[];
  dispatch: (pass: GPUComputePassEncoder) => void;
  pending: () => boolean;
  clear: (encoder: GPUCommandEncoder) => void;
};

export type PitchArg = {
  sampleRate: number;
  fourierMode: FourierMode;
  columnStep: number;
  windowCount: number;
};

type Pending = {
  plan: PitchPlan;
  trackFrames: number;
  projection: PitchProjection;
};

type SampleIdentity = {
  samples: Float32Array | undefined;
  length: number;
};

export const createSpectrogramFundamentalFrequencyCell = (
  device: GPUDevice,
): ResourceCell<PitchArg, SpectrogramFundamentalFrequency> => {
  const pipelines = createPitchPipelines(device);
  const settingsCell = createResourceCell({
    create: createPitchSettings,
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
  const scheduleCell = createResourceCell({
    create: createPitchSchedule,
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
  const buffersCell = createPitchBuffersCell(device);
  const paramsCell = createPitchParamsCell(device);
  const lineCell = createPitchLineCell(device);
  const bindGroupsCell = createPitchBindGroupsCell(device, pipelines);
  const fourierCell = createFourierCell(device);
  let pending: Pending | undefined = undefined;
  const identity: SampleIdentity = { samples: undefined, length: 0 };

  return {
    get: (arg) => {
      const settings = settingsCell.get(arg.sampleRate);
      const schedule = scheduleCell.get(settings);
      const buffers = buffersCell.get(settings);
      const params = paramsCell.get(settings);
      const line = lineCell.get(arg.windowCount);
      const bindGroups = bindGroupsCell.get({ buffers, line, params });
      const fourier = fourierCell.get({
        signal: buffers.signal,
        config: {
          fourierMode: arg.fourierMode,
          windowSize: settings.fftSize,
          zeroPaddingFactor: 1,
          windowCount: settings.batchSlots,
        },
      });

      const dispatchValues = (
        state: Pending,
        decode: PitchFrameRange | undefined,
      ) => ({
        slotCount: state.plan.slots.length,
        trackFrames: state.trackFrames,
        decodeFirst: decode ? decode.first : 0,
        decodeCount: decode ? decode.count : 0,
        baseColumn: state.projection.baseColumn,
        columnStep: arg.columnStep,
        windowCount: arg.windowCount,
        baseSlot: state.projection.baseSlot,
      });

      const analysisStage = (
        label: string,
        run: (pass: GPUComputePassEncoder, state: Pending) => void,
      ): PitchStage => ({
        label,
        dispatch: (pass) => {
          if (pending && pending.plan.slots.length > 0) {
            run(pass, pending);
          }
        },
      });

      const bindAnalysis = (
        pass: GPUComputePassEncoder,
        state: Pending,
        pipeline: GPUComputePipeline,
        bindGroup: GPUBindGroup,
      ): void => {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup, [
          params.write(dispatchValues(state, undefined)),
        ]);
      };

      const stages: PitchStage[] = [
        analysisStage('slice', (pass, state) => {
          bindAnalysis(pass, state, pipelines.slice, bindGroups.slice);
          pass.dispatchWorkgroups(
            Math.ceil(settings.fftSize / workgroupSize),
            state.plan.slots.length,
          );
        }),
        analysisStage('fft', (pass, state) => {
          fourier.dispatch(pass, {
            batchOffset: 0,
            batchCount: state.plan.slots.length,
          });
        }),
        analysisStage('spectrum', (pass, state) => {
          bindAnalysis(pass, state, pipelines.spectrum, bindGroups.spectrum);
          pass.dispatchWorkgroups(state.plan.slots.length);
        }),
        analysisStage('periodicity', (pass, state) => {
          bindAnalysis(
            pass,
            state,
            pipelines.periodicity,
            bindGroups.periodicity,
          );
          pass.dispatchWorkgroups(state.plan.slots.length);
        }),
        analysisStage('observe', (pass, state) => {
          bindAnalysis(pass, state, pipelines.observe, bindGroups.observe);
          pass.dispatchWorkgroups(state.plan.slots.length);
        }),
        {
          label: 'decode',
          dispatch: (pass) => {
            const state = pending;
            if (!state) {
              return;
            }
            pass.setPipeline(pipelines.decode);
            for (const decode of state.plan.decodes) {
              pass.setBindGroup(0, bindGroups.decode, [
                params.write(dispatchValues(state, decode)),
              ]);
              pass.dispatchWorkgroups(Math.ceil(decode.count / workgroupSize));
            }
          },
        },
        {
          label: 'project',
          dispatch: (pass) => {
            const state = pending;
            if (!state) {
              return;
            }
            pass.setPipeline(pipelines.project);
            pass.setBindGroup(0, bindGroups.project, [
              params.write(dispatchValues(state, undefined)),
            ]);
            pass.dispatchWorkgroups(Math.ceil(arg.windowCount / workgroupSize));
          },
        },
      ];

      return {
        settings,
        lineBuffer: line,
        decodedBuffer: buffers.decoded,
        prepare: (input) => {
          const { samples, projection } = input;
          const reset =
            identity.samples !== samples || identity.length !== samples.length;
          identity.samples = samples;
          identity.length = samples.length;
          const trackFrames = frameCountOf(settings, samples.length);
          const availableSamples = input.truncated
            ? Math.round(input.trackProgress * samples.length)
            : samples.length;
          const firstTime = projection.baseColumn * arg.columnStep;
          const lastTime =
            (projection.baseColumn + arg.windowCount - 1) * arg.columnStep;
          const plan = schedule.plan({
            trackFrames,
            truncated: input.truncated,
            availableSamples,
            visibleFirst: Math.floor(firstTime / settings.hop) - 1,
            visibleLast: Math.ceil(lastTime / settings.hop) + 1,
            invalidations: input.invalidations,
            reset,
          });
          uploadSpans(device, buffers.span, {
            plan,
            samples,
            availableSamples,
          });
          uploadSlots(device, buffers.slots, plan);
          pending = { plan, trackFrames, projection };
        },
        stages,
        dispatch: (pass) => {
          for (const stage of stages) {
            stage.dispatch(pass);
          }
        },
        pending: () => (pending ? !pending.plan.complete : false),
        clear: (encoder) => {
          encoder.clearBuffer(line);
        },
      };
    },
    dispose: () => {
      bindGroupsCell.dispose();
      lineCell.dispose();
      paramsCell.dispose();
      buffersCell.dispose();
      fourierCell.dispose();
      scheduleCell.dispose();
      settingsCell.dispose();
    },
  };
};
