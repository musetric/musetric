import { type FourierMode } from '@musetric/fft';
import { createFourierCell } from '@musetric/fft/gpu';
import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type SpectrogramSource } from '../common/source.js';
import { createPitchInverseCell } from './inverse.js';
import { createPitchParamsCell } from './params.js';
import { createPitchPipelines } from './pipeline.js';
import {
  createPitchSchedule,
  type PitchFrameRange,
  type PitchPlan,
} from './schedule.es.js';
import { type PitchSampleRange } from './scheduleState.es.js';
import { createPitchSettings, type PitchSettings } from './settings.es.js';
import {
  createPitchBindGroupsCell,
  createPitchBuffersCell,
  createPitchLineCell,
} from './state.js';
import { uploadSlots, uploadSpans } from './upload.js';

const workgroupSize = 64;

const frameCountOf = (settings: PitchSettings, length: number): number =>
  length > 0 ? Math.floor((length - 1) / settings.hop) + 1 : 0;

export type PitchProjection = {
  baseColumn: number;
  baseSlot: number;
};

export type PitchPrepareInput = {
  source: SpectrogramSource;
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
  shownFrames: number;
  projection: PitchProjection;
};

type SampleIdentity = {
  source: SpectrogramSource | undefined;
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
  const inverseCell = createPitchInverseCell(device);
  let pending: Pending | undefined = undefined;
  const identity: SampleIdentity = { source: undefined, length: 0 };

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
      const inverse = inverseCell.get(buffers, settings);

      const dispatchValues = (
        state: Pending,
        decode: PitchFrameRange | undefined,
      ) => ({
        slotCount: state.plan.slots.length,
        trackFrames: state.trackFrames,
        decodeFirst: decode ? decode.first : 0,
        decodeCount: decode ? decode.count : 0,
        smoothFirst: state.plan.smooth.first,
        smoothCount: state.plan.smooth.count,
        foldFirst: state.plan.fold.first,
        foldCount: state.plan.fold.count,
        baseColumn: state.projection.baseColumn,
        columnStep: arg.columnStep,
        windowCount: arg.windowCount,
        baseSlot: state.projection.baseSlot,
        shownFrames: state.shownFrames,
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
        analysisStage('power', (pass, state) => {
          bindAnalysis(pass, state, pipelines.power, bindGroups.power);
          pass.dispatchWorkgroups(
            Math.ceil((settings.halfSize + 1) / workgroupSize),
            state.plan.slots.length,
          );
        }),
        analysisStage('autocorrelation', (pass, state) => {
          inverse.dispatch(pass, {
            batchOffset: 0,
            batchCount: state.plan.slots.length,
          });
        }),
        analysisStage('periodicity', (pass, state) => {
          bindAnalysis(
            pass,
            state,
            pipelines.periodicity,
            bindGroups.periodicity,
          );
          pass.dispatchWorkgroups(
            Math.ceil(settings.lagCount / workgroupSize),
            state.plan.slots.length,
          );
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
          label: 'fold',
          dispatch: (pass) => {
            const state = pending;
            if (!state || state.plan.fold.count === 0) {
              return;
            }
            pass.setPipeline(pipelines.fold);
            pass.setBindGroup(0, bindGroups.fold, [
              params.write(dispatchValues(state, undefined)),
            ]);
            pass.dispatchWorkgroups(
              Math.ceil(state.plan.fold.count / workgroupSize),
            );
          },
        },
        {
          label: 'smooth',
          dispatch: (pass) => {
            const state = pending;
            if (!state || state.plan.smooth.count === 0) {
              return;
            }
            pass.setPipeline(pipelines.smooth);
            pass.setBindGroup(0, bindGroups.smooth, [
              params.write(dispatchValues(state, undefined)),
            ]);
            pass.dispatchWorkgroups(
              Math.ceil(state.plan.smooth.count / workgroupSize),
            );
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
          const { source, projection } = input;
          const reset =
            identity.source !== source || identity.length !== source.length;
          identity.source = source;
          identity.length = source.length;
          const trackFrames = frameCountOf(settings, source.songLength);
          const availableSamples = input.truncated
            ? Math.round(input.trackProgress * source.songLength)
            : source.songLength;
          const reach = Math.ceil(settings.support * (source.reach - 1));
          const firstTime = projection.baseColumn * arg.columnStep;
          const lastTime =
            (projection.baseColumn + arg.windowCount - 1) * arg.columnStep;
          const plan = schedule.plan({
            trackFrames,
            truncated: input.truncated,
            availableSamples,
            visibleFirst: Math.floor(firstTime / settings.hop) - 1,
            visibleLast: Math.ceil(lastTime / settings.hop) + 1,
            invalidations: input.invalidations.map((invalidation) => ({
              frameIndex: invalidation.frameIndex - reach,
              frameCount: invalidation.frameCount + 2 * reach,
            })),
            reset,
            position: source.position,
          });
          uploadSpans(device, buffers.span, {
            plan,
            source,
            availableSamples: Math.round(source.position(availableSamples)),
          });
          uploadSlots(device, buffers.slots, plan);
          const shownFrames = input.truncated
            ? Math.min(
                trackFrames,
                Math.floor(availableSamples / settings.hop) + 1,
              )
            : trackFrames;
          pending = { plan, trackFrames, shownFrames, projection };
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
      inverseCell.dispose();
      scheduleCell.dispose();
      settingsCell.dispose();
    },
  };
};
