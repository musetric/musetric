import {
  createFftPackedStockhamR2c,
  createIfftPackedStockhamC2r,
} from '@musetric/fft/gpu';
import * as ort from 'onnxruntime-web/webgpu';
import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createReadbackBuffer,
  createStorageBuffer,
  dispatch1d,
  dispatch2d,
  type Dispatch2dOptions,
} from './helpers.js';

ort.env.logLevel = 'error';

export type StftStage = Omit<Dispatch2dOptions, 'pass'>;

const runStage = (encoder: GPUCommandEncoder, stage: StftStage): void => {
  const pass = encoder.beginComputePass();
  dispatch2d({ pass, ...stage });
  pass.end();
};

export type StftInferenceRuntime = {
  processChunk: (
    input: Float32Array<ArrayBuffer>,
    output?: Float32Array<ArrayBuffer>,
  ) => Promise<Float32Array<ArrayBuffer>>;
  release: () => Promise<void>;
};

export type StftInferenceModel = {
  nFft: number;
  hop: number;
  channels: number;
  chunkSamples: number;
  frames: number;
  inputName: string;
  outputName: string;
  inputShape: readonly number[];
  outputShape: readonly number[];
};

export type StftInferenceBuffers = {
  device: GPUDevice;
  wave: GPUBuffer;
  spectrum: GPUBuffer;
};

export type StftInferenceCore = {
  modelInput: GPUBuffer;
  modelOutput: GPUBuffer;
  analysis: StftStage;
  synthesis: StftStage;
  release: () => void;
};

export type StftInferenceOptions = {
  label: string;
  model: StftInferenceModel;
  modelUrl: string;
  externalData?: NonNullable<
    ort.InferenceSession.SessionOptions['externalData']
  >;
  frameShader: string;
  overlapAddShader: string;
  createCore: (buffers: StftInferenceBuffers) => StftInferenceCore;
};

export const createStftInferenceRuntime = async (
  options: StftInferenceOptions,
): Promise<StftInferenceRuntime> => {
  const { label, model, frameShader, overlapAddShader, createCore } = options;
  const { nFft, hop, channels, chunkSamples, frames } = model;
  const pad = nFft / 2;
  const windowCount = channels * frames;
  const chunkFloats = channels * chunkSamples;
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  const spectrumBytes =
    windowCount * (nFft + 2) * Float32Array.BYTES_PER_ELEMENT;

  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    preferredOutputLocation: { [model.outputName]: 'gpu-buffer' },
    ...(options.externalData ? { externalData: options.externalData } : {}),
  });
  const device = await ort.env.webgpu.device;

  const frameLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const framePipeline = createComputePipeline({
    device,
    layout: frameLayout,
    code: frameShader,
    constants: { nFft, hop, pad, frames, windowCount, samples: chunkSamples },
  });
  const overlapAddLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const overlapAddPipeline = createComputePipeline({
    device,
    layout: overlapAddLayout,
    code: overlapAddShader,
    constants: { nFft, hop, pad, frames, channels, samples: chunkSamples },
  });

  const fftCell = createFftPackedStockhamR2c(device);
  const ifftCell = createIfftPackedStockhamC2r(device);
  const rawAudio = createStorageBuffer(device, chunkBytes);
  const wave = createStorageBuffer(device, spectrumBytes);
  const spectrum = createStorageBuffer(device, spectrumBytes);
  const frameTime = createStorageBuffer(
    device,
    windowCount * nFft * Float32Array.BYTES_PER_ELEMENT,
  );
  const outputAudio = createStorageBuffer(device, chunkBytes);
  const readback = createReadbackBuffer(device, chunkBytes);

  const core = createCore({ device, wave, spectrum });

  const frameStage: StftStage = {
    pipeline: framePipeline,
    bindGroup: createBindGroup(device, frameLayout, [rawAudio, wave]),
    x: nFft,
    y: windowCount,
  };
  const overlapAddBindGroup = createBindGroup(device, overlapAddLayout, [
    frameTime,
    outputAudio,
  ]);
  const fft = fftCell.get({
    wave,
    spectrum: wave,
    config: { windowSize: nFft, windowCount },
  });
  const ifft = ifftCell.get({
    wave: frameTime,
    spectrum,
    config: { windowSize: nFft, windowCount },
  });
  const inputTensor = ort.Tensor.fromGpuBuffer(core.modelInput, {
    dataType: 'float32',
    dims: [...model.inputShape],
  });
  const outputTensor = ort.Tensor.fromGpuBuffer(core.modelOutput, {
    dataType: 'float32',
    dims: [...model.outputShape],
  });

  const processChunk = async (
    input: Float32Array<ArrayBuffer>,
    output?: Float32Array<ArrayBuffer>,
  ): Promise<Float32Array<ArrayBuffer>> => {
    if (
      input.length !== chunkFloats ||
      (output && output.length !== chunkFloats)
    ) {
      throw new Error(`${label} chunk must contain ${chunkFloats} floats`);
    }
    device.queue.writeBuffer(rawAudio, 0, input);

    const stftEncoder = device.createCommandEncoder();
    runStage(stftEncoder, frameStage);
    fft.run(stftEncoder);
    runStage(stftEncoder, core.analysis);
    device.queue.submit([stftEncoder.finish()]);

    const result = await session.run(
      { [model.inputName]: inputTensor },
      { [model.outputName]: outputTensor },
    );
    const modelResult = result[model.outputName];
    if (modelResult.gpuBuffer !== core.modelOutput) {
      modelResult.dispose();
      throw new Error(
        `${label} model output did not reuse the preallocated GPU buffer`,
      );
    }

    const istftEncoder = device.createCommandEncoder();
    runStage(istftEncoder, core.synthesis);
    ifft.run(istftEncoder);
    const overlapAddPass = istftEncoder.beginComputePass();
    dispatch1d(
      overlapAddPass,
      overlapAddPipeline,
      overlapAddBindGroup,
      chunkFloats,
    );
    overlapAddPass.end();
    istftEncoder.copyBufferToBuffer(outputAudio, 0, readback, 0, chunkBytes);
    device.queue.submit([istftEncoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(readback.getMappedRange());
    const audio = output ?? new Float32Array(mapped.length);
    audio.set(mapped);
    readback.unmap();
    return audio;
  };

  const release = async (): Promise<void> => {
    fftCell.dispose();
    ifftCell.dispose();
    for (const buffer of [
      rawAudio,
      wave,
      spectrum,
      frameTime,
      outputAudio,
      readback,
    ]) {
      buffer.destroy();
    }
    core.release();
    await session.release();
  };

  return { processChunk, release };
};
