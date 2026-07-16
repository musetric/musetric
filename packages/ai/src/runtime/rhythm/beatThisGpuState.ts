import { type createFftPackedStockhamR2c } from '@musetric/fft/gpu';
import { beatThisModel } from '../../models/beatThisModel.js';
import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createReadbackBuffer,
  createStorageBuffer,
} from '../helpers.js';
import { rhythmFrameShader } from './frame.wgsl.js';
import { rhythmMelShader } from './mel.wgsl.js';
import { rhythmWindowsShader } from './windows.wgsl.js';

export const getFrameCount = (sampleCount: number): number =>
  Math.floor(sampleCount / beatThisModel.hopLength) + 1;

export const getWindowStarts = (frames: number): number[] => {
  const stride = beatThisModel.chunkSize - 2 * beatThisModel.borderSize;
  const starts: number[] = [];
  for (
    let start = -beatThisModel.borderSize;
    start < frames - beatThisModel.borderSize;
    start += stride
  ) {
    starts.push(start);
  }
  if (frames > stride && starts.length > 0) {
    starts[starts.length - 1] =
      frames - (beatThisModel.chunkSize - beatThisModel.borderSize);
  }
  return starts;
};

export const getWindowFrames = (frames: number): number => {
  const stride = beatThisModel.chunkSize - 2 * beatThisModel.borderSize;
  return frames > stride
    ? beatThisModel.chunkSize
    : frames + 2 * beatThisModel.borderSize;
};

export type BeatThisGpuState = {
  sampleCount: number;
  frames: number;
  windowFrames: number;
  starts: number[];
  rawAudio: GPUBuffer;
  wave: GPUBuffer;
  spect: GPUBuffer;
  startsBuffer: GPUBuffer;
  windows: GPUBuffer;
  windowInput: GPUBuffer;
  beatWindow: GPUBuffer;
  downbeatWindow: GPUBuffer;
  beat: GPUBuffer;
  downbeat: GPUBuffer;
  readback: GPUBuffer;
  fft: ReturnType<ReturnType<typeof createFftPackedStockhamR2c>['get']>;
  framePipeline: GPUComputePipeline;
  frameBindGroup: GPUBindGroup;
  melPipeline: GPUComputePipeline;
  melBindGroup: GPUBindGroup;
  windowsPipeline: GPUComputePipeline;
  windowsBindGroup: GPUBindGroup;
};

export type CreateBeatThisGpuStateOptions = {
  device: GPUDevice;
  fftCell: ReturnType<typeof createFftPackedStockhamR2c>;
  filterbank: GPUBuffer;
  sampleCount: number;
};

export const createBeatThisGpuState = (
  options: CreateBeatThisGpuStateOptions,
): BeatThisGpuState => {
  const { device, fftCell, filterbank, sampleCount } = options;
  const bins = beatThisModel.nFft / 2 + 1;
  const frames = getFrameCount(sampleCount);
  const windowFrames = getWindowFrames(frames);
  const starts = getWindowStarts(frames);

  const rawAudio = createStorageBuffer(
    device,
    sampleCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const wave = createStorageBuffer(
    device,
    frames * (beatThisModel.nFft + 2) * Float32Array.BYTES_PER_ELEMENT,
  );
  const spect = createStorageBuffer(
    device,
    frames * beatThisModel.melBins * Float32Array.BYTES_PER_ELEMENT,
  );
  const startsBuffer = createStorageBuffer(
    device,
    starts.length * Int32Array.BYTES_PER_ELEMENT,
  );
  const windows = createStorageBuffer(
    device,
    starts.length *
      windowFrames *
      beatThisModel.melBins *
      Float32Array.BYTES_PER_ELEMENT,
  );
  const windowInput = createStorageBuffer(
    device,
    windowFrames * beatThisModel.melBins * Float32Array.BYTES_PER_ELEMENT,
  );
  const beatWindow = createStorageBuffer(
    device,
    windowFrames * Float32Array.BYTES_PER_ELEMENT,
  );
  const downbeatWindow = createStorageBuffer(
    device,
    windowFrames * Float32Array.BYTES_PER_ELEMENT,
  );
  const beat = createStorageBuffer(
    device,
    frames * Float32Array.BYTES_PER_ELEMENT,
  );
  const downbeat = createStorageBuffer(
    device,
    frames * Float32Array.BYTES_PER_ELEMENT,
  );
  const readback = createReadbackBuffer(
    device,
    frames * Float32Array.BYTES_PER_ELEMENT,
  );

  device.queue.writeBuffer(startsBuffer, 0, Int32Array.from(starts));

  const frameLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const framePipeline = createComputePipeline({
    device,
    layout: frameLayout,
    code: rhythmFrameShader,
    constants: {
      nFft: beatThisModel.nFft,
      hop: beatThisModel.hopLength,
      pad: beatThisModel.nFft / 2,
      frames,
      samples: sampleCount,
    },
  });
  const frameBindGroup = createBindGroup(device, frameLayout, [rawAudio, wave]);

  const melLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'read-only-storage',
    'storage',
  ]);
  const melPipeline = createComputePipeline({
    device,
    layout: melLayout,
    code: rhythmMelShader,
    constants: {
      nFft: beatThisModel.nFft,
      bins,
      melBins: beatThisModel.melBins,
      frames,
      fftScale: 1 / Math.sqrt(beatThisModel.nFft),
      logMultiplier: beatThisModel.logMultiplier,
    },
  });
  const melBindGroup = createBindGroup(device, melLayout, [
    wave,
    filterbank,
    spect,
  ]);

  const windowsLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'read-only-storage',
    'storage',
  ]);
  const windowsPipeline = createComputePipeline({
    device,
    layout: windowsLayout,
    code: rhythmWindowsShader,
    constants: {
      melBins: beatThisModel.melBins,
      frames,
      windowFrames,
      windowCount: starts.length,
    },
  });
  const windowsBindGroup = createBindGroup(device, windowsLayout, [
    spect,
    startsBuffer,
    windows,
  ]);

  const fft = fftCell.get({
    wave,
    spectrum: wave,
    config: { windowSize: beatThisModel.nFft, windowCount: frames },
  });

  return {
    sampleCount,
    frames,
    windowFrames,
    starts,
    rawAudio,
    wave,
    spect,
    startsBuffer,
    windows,
    windowInput,
    beatWindow,
    downbeatWindow,
    beat,
    downbeat,
    readback,
    fft,
    framePipeline,
    frameBindGroup,
    melPipeline,
    melBindGroup,
    windowsPipeline,
    windowsBindGroup,
  };
};

export const destroyBeatThisGpuState = (state: BeatThisGpuState): void => {
  for (const buffer of [
    state.rawAudio,
    state.wave,
    state.spect,
    state.startsBuffer,
    state.windows,
    state.windowInput,
    state.beatWindow,
    state.downbeatWindow,
    state.beat,
    state.downbeat,
    state.readback,
  ]) {
    buffer.destroy();
  }
};
