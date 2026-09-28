import { windowFunctions } from '@musetric/fft';
import { createResourceCell } from '@musetric/utils';
import { type PitchParams } from './params.js';
import { type PitchPipelines } from './pipeline.js';
import { type PitchSettings } from './settings.es.js';

export const pitchSlotBytes = 16;
export const pitchObservationBytes = 56;
export const pitchDecodedBytes = 16;

export type PitchBuffers = {
  span: GPUBuffer;
  slots: GPUBuffer;
  weights: GPUBuffer;
  signal: GPUBuffer;
  whitened: GPUBuffer;
  frequencies: GPUBuffer;
  levels: GPUBuffer;
  periodicity: GPUBuffer;
  observations: GPUBuffer;
  decoded: GPUBuffer;
  folded: GPUBuffer;
};

const createPitchBuffers = (
  device: GPUDevice,
  settings: PitchSettings,
): PitchBuffers => {
  const create = (label: string, size: number, usage: number): GPUBuffer =>
    device.createBuffer({
      label: `pitch-${label}-buffer`,
      size: Math.max(16, size),
      usage,
    });
  const slots = settings.batchSlots;
  const weights = create(
    'weights',
    settings.windowSize * Float32Array.BYTES_PER_ELEMENT,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(
    weights,
    0,
    windowFunctions[settings.windowName](settings.windowSize),
  );
  return {
    span: create(
      'span',
      settings.spanCapacity * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    slots: create(
      'slots',
      slots * pitchSlotBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    weights,
    signal: create(
      'signal',
      slots * (settings.fftSize + 2) * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    ),
    whitened: create(
      'whitened',
      slots * settings.spectrumBins * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE,
    ),
    frequencies: create(
      'frequencies',
      slots * settings.phaseBins * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE,
    ),
    levels: create(
      'levels',
      slots * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE,
    ),
    periodicity: create(
      'periodicity',
      slots * settings.lagCount * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE,
    ),
    observations: create(
      'observations',
      settings.ringFrames * pitchObservationBytes,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    ),
    decoded: create(
      'decoded',
      settings.ringFrames * pitchDecodedBytes,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    ),
    folded: create(
      'folded',
      settings.ringFrames * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE,
    ),
  };
};

const destroyPitchBuffers = (buffers: PitchBuffers): void => {
  for (const buffer of Object.values(buffers)) {
    buffer.destroy();
  }
};

export const createPitchBuffersCell = (device: GPUDevice) =>
  createResourceCell({
    create: (settings: PitchSettings) => createPitchBuffers(device, settings),
    dispose: destroyPitchBuffers,
    equals: (current, next) => current === next,
  });

export const createPitchLineCell = (device: GPUDevice) =>
  createResourceCell({
    create: (windowCount: number): GPUBuffer =>
      device.createBuffer({
        label: 'pitch-line-buffer',
        size: Math.max(1, windowCount) * Float32Array.BYTES_PER_ELEMENT,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) => current === next,
  });

export type PitchBindGroups = {
  slice: GPUBindGroup;
  spectrum: GPUBindGroup;
  periodicity: GPUBindGroup;
  observe: GPUBindGroup;
  decode: GPUBindGroup;
  fold: GPUBindGroup;
  smooth: GPUBindGroup;
  project: GPUBindGroup;
};

type BindGroupsArg = {
  buffers: PitchBuffers;
  line: GPUBuffer;
  params: PitchParams;
};

const createBindGroups = (
  device: GPUDevice,
  pipelines: PitchPipelines,
  arg: BindGroupsArg,
): PitchBindGroups => {
  const { buffers, line, params } = arg;
  const uniform = { buffer: params.buffer, size: params.byteLength };
  const create = (
    pipeline: GPUComputePipeline,
    label: string,
    resources: GPUBufferBinding[],
  ): GPUBindGroup =>
    device.createBindGroup({
      label: `pitch-${label}-bind-group`,
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });
  return {
    slice: create(pipelines.slice, 'slice', [
      { buffer: buffers.span },
      { buffer: buffers.slots },
      { buffer: buffers.weights },
      { buffer: buffers.signal },
      uniform,
    ]),
    spectrum: create(pipelines.spectrum, 'spectrum', [
      { buffer: buffers.signal },
      { buffer: buffers.slots },
      { buffer: buffers.whitened },
      { buffer: buffers.frequencies },
      { buffer: buffers.levels },
      uniform,
    ]),
    periodicity: create(pipelines.periodicity, 'periodicity', [
      { buffer: buffers.span },
      { buffer: buffers.slots },
      { buffer: buffers.periodicity },
      uniform,
    ]),
    observe: create(pipelines.observe, 'observe', [
      { buffer: buffers.slots },
      { buffer: buffers.whitened },
      { buffer: buffers.frequencies },
      { buffer: buffers.levels },
      { buffer: buffers.periodicity },
      { buffer: buffers.observations },
      { buffer: buffers.signal },
      uniform,
    ]),
    decode: create(pipelines.decode, 'decode', [
      { buffer: buffers.observations },
      { buffer: buffers.decoded },
      uniform,
    ]),
    fold: create(pipelines.fold, 'fold', [
      { buffer: buffers.decoded },
      { buffer: buffers.observations },
      { buffer: buffers.folded },
      uniform,
    ]),
    smooth: create(pipelines.smooth, 'smooth', [
      { buffer: buffers.decoded },
      { buffer: buffers.folded },
      uniform,
    ]),
    project: create(pipelines.project, 'project', [
      { buffer: buffers.decoded },
      { buffer: line },
      uniform,
    ]),
  };
};

export const createPitchBindGroupsCell = (
  device: GPUDevice,
  pipelines: PitchPipelines,
) =>
  createResourceCell({
    create: (arg: BindGroupsArg) => createBindGroups(device, pipelines, arg),
    dispose: () => undefined,
    equals: (current, next) =>
      current.buffers === next.buffers &&
      current.line === next.line &&
      current.params === next.params,
  });
