import { createFftPackedStockhamR2c } from '@musetric/fft/gpu';
import * as ort from 'onnxruntime-web/webgpu';
import { beatThisModel } from '../../models/beatThisModel.js';
import { createStorageBuffer, dispatch2d } from '../helpers.js';
import {
  type BeatThisGpuState,
  createBeatThisGpuState,
  destroyBeatThisGpuState,
} from './beatThisGpuState.js';

ort.env.logLevel = 'error';

const emptyLogit = -1000;

const readBuffer = async (
  device: GPUDevice,
  state: BeatThisGpuState,
  source: GPUBuffer,
): Promise<Float32Array> => {
  const size = state.frames * Float32Array.BYTES_PER_ELEMENT;
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, state.readback, 0, size);
  device.queue.submit([encoder.finish()]);
  await state.readback.mapAsync(GPUMapMode.READ, 0, size);
  const values = Float32Array.from(
    new Float32Array(state.readback.getMappedRange(0, size)),
  );
  state.readback.unmap();
  return values;
};

const encodeFeatures = (device: GPUDevice, state: BeatThisGpuState): void => {
  const encoder = device.createCommandEncoder();
  const framePass = encoder.beginComputePass({ label: 'rhythm-frame' });
  dispatch2d({
    pass: framePass,
    pipeline: state.framePipeline,
    bindGroup: state.frameBindGroup,
    x: beatThisModel.nFft,
    y: state.frames,
  });
  framePass.end();
  state.fft.run(encoder);
  const melPass = encoder.beginComputePass({ label: 'rhythm-mel' });
  dispatch2d({
    pass: melPass,
    pipeline: state.melPipeline,
    bindGroup: state.melBindGroup,
    x: beatThisModel.melBins,
    y: state.frames,
  });
  melPass.end();
  const windowsPass = encoder.beginComputePass({ label: 'rhythm-windows' });
  dispatch2d({
    pass: windowsPass,
    pipeline: state.windowsPipeline,
    bindGroup: state.windowsBindGroup,
    x: beatThisModel.melBins,
    y: state.windowFrames * state.starts.length,
  });
  windowsPass.end();
  device.queue.submit([encoder.finish()]);
};

export type BeatThisLogits = {
  beat: Float32Array;
  downbeat: Float32Array;
};

export type BeatThisGpuRuntime = {
  analyze: (
    audio: Float32Array,
    onProgress?: (progress: number) => Promise<void>,
  ) => Promise<BeatThisLogits>;
  release: () => Promise<void>;
};

export type BeatThisGpuRuntimeOptions = {
  modelUrl: string;
  filterbank: Float32Array;
};

export const createBeatThisGpuRuntime = async (
  options: BeatThisGpuRuntimeOptions,
): Promise<BeatThisGpuRuntime> => {
  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    preferredOutputLocation: {
      [beatThisModel.beatOutputName]: 'gpu-buffer',
      [beatThisModel.downbeatOutputName]: 'gpu-buffer',
    },
  });
  const device = await ort.env.webgpu.device;
  const fftCell = createFftPackedStockhamR2c(device);
  const filterbank = createStorageBuffer(
    device,
    options.filterbank.length * Float32Array.BYTES_PER_ELEMENT,
  );
  device.queue.writeBuffer(filterbank, 0, options.filterbank);
  let state: BeatThisGpuState | undefined = undefined;

  const ensureState = (sampleCount: number): BeatThisGpuState => {
    if (state?.sampleCount === sampleCount) {
      return state;
    }
    if (state !== undefined) {
      destroyBeatThisGpuState(state);
    }
    state = createBeatThisGpuState({
      device,
      fftCell,
      filterbank,
      sampleCount,
    });
    return state;
  };

  const runWindow = async (
    current: BeatThisGpuState,
    index: number,
  ): Promise<void> => {
    const windowBytes =
      current.windowFrames *
      beatThisModel.melBins *
      Float32Array.BYTES_PER_ELEMENT;
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(
      current.windows,
      index * windowBytes,
      current.windowInput,
      0,
      windowBytes,
    );
    device.queue.submit([copyEncoder.finish()]);

    const input = ort.Tensor.fromGpuBuffer(current.windowInput, {
      dataType: 'float32',
      dims: [1, current.windowFrames, beatThisModel.melBins],
    });
    const result = await session.run(
      { [beatThisModel.modelInputName]: input },
      {
        [beatThisModel.beatOutputName]: ort.Tensor.fromGpuBuffer(
          current.beatWindow,
          { dataType: 'float32', dims: [1, current.windowFrames] },
        ),
        [beatThisModel.downbeatOutputName]: ort.Tensor.fromGpuBuffer(
          current.downbeatWindow,
          { dataType: 'float32', dims: [1, current.windowFrames] },
        ),
      },
    );
    const pairs = [
      [beatThisModel.beatOutputName, current.beatWindow, current.beat],
      [
        beatThisModel.downbeatOutputName,
        current.downbeatWindow,
        current.downbeat,
      ],
    ] as const;
    for (const [name, windowBuffer] of pairs) {
      if (result[name].gpuBuffer !== windowBuffer) {
        result[name].dispose();
        throw new Error(
          `Beat This! ${name} did not reuse the preallocated GPU buffer`,
        );
      }
    }

    const at = current.starts[index] + beatThisModel.borderSize;
    const count = Math.min(
      current.windowFrames - 2 * beatThisModel.borderSize,
      current.frames - at,
    );
    const writeEncoder = device.createCommandEncoder();
    for (const [, windowBuffer, target] of pairs) {
      writeEncoder.copyBufferToBuffer(
        windowBuffer,
        beatThisModel.borderSize * Float32Array.BYTES_PER_ELEMENT,
        target,
        at * Float32Array.BYTES_PER_ELEMENT,
        count * Float32Array.BYTES_PER_ELEMENT,
      );
    }
    device.queue.submit([writeEncoder.finish()]);
  };

  const analyze = async (
    audio: Float32Array,
    onProgress?: (progress: number) => Promise<void>,
  ): Promise<BeatThisLogits> => {
    const current = ensureState(audio.length);
    const empty = new Float32Array(current.frames).fill(emptyLogit);
    device.queue.writeBuffer(current.rawAudio, 0, audio);
    device.queue.writeBuffer(current.beat, 0, empty);
    device.queue.writeBuffer(current.downbeat, 0, empty);
    encodeFeatures(device, current);

    for (let index = current.starts.length - 1; index >= 0; index -= 1) {
      await runWindow(current, index);
      await onProgress?.(
        (current.starts.length - index) / current.starts.length,
      );
    }

    return {
      beat: await readBuffer(device, current, current.beat),
      downbeat: await readBuffer(device, current, current.downbeat),
    };
  };

  const release = async (): Promise<void> => {
    fftCell.dispose();
    filterbank.destroy();
    if (state !== undefined) {
      destroyBeatThisGpuState(state);
      state = undefined;
    }
    await session.release();
  };

  return { analyze, release };
};
