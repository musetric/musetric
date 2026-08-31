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
import { configureOrtWebGpu } from './ortWebGpu.js';
import {
  assertStorageBufferLimit,
  defaultStorageBufferLimit,
  getMusetricWebGpuDevice,
  prepareMusetricWebGpu,
} from './webgpuDevice.js';

ort.env.logLevel = 'error';

export type StftStage = Omit<Dispatch2dOptions, 'pass'>;

const runStage = (encoder: GPUCommandEncoder, stage: StftStage): void => {
  const pass = encoder.beginComputePass();
  dispatch2d({ pass, ...stage });
  pass.end();
};

const baseMobileGpuCooldownMilliseconds =
  globalThis.navigator.userAgent.includes('Android') ? 1_000 : 0;

const getAndroidThermalStatus = (): number => {
  const bridge = Reflect.get(globalThis, 'MusetricThermal');
  if (typeof bridge !== 'object' || !bridge) {
    return 0;
  }
  const getStatus = Reflect.get(bridge, 'status');
  if (typeof getStatus !== 'function') {
    return 0;
  }
  const status: unknown = Reflect.apply(getStatus, bridge, []);
  return typeof status === 'number' ? status : 0;
};

const yieldGpuToCompositor = async (): Promise<void> => {
  if (baseMobileGpuCooldownMilliseconds === 0) {
    return;
  }
  const thermalStatus = getAndroidThermalStatus();
  let cooldownMilliseconds = baseMobileGpuCooldownMilliseconds;
  if (thermalStatus >= 3) {
    cooldownMilliseconds = 15_000;
  } else if (thermalStatus >= 2) {
    cooldownMilliseconds = 8_000;
  } else if (thermalStatus >= 1) {
    cooldownMilliseconds = 3_000;
  }
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, cooldownMilliseconds);
  });
};

const getInputScale = (
  input: Float32Array<ArrayBuffer>,
  normalizedPeak: number | undefined,
): number => {
  if (normalizedPeak === undefined) {
    return 1;
  }
  let peak = 0;
  for (let index = 0; index < input.length; index += 1) {
    peak = Math.max(peak, Math.abs(input[index]));
  }
  return peak > 0 ? normalizedPeak / peak : 1;
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
  minStorageBuffersPerShaderStage?: number;
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
  graphOptimizationLevel?: NonNullable<
    ort.InferenceSession.SessionOptions['graphOptimizationLevel']
  >;
  frameShader: string;
  overlapAddShader: string;
  normalizedPeak?: number;
  createCore: (buffers: StftInferenceBuffers) => StftInferenceCore;
};

export const createStftInferenceRuntime = async (
  options: StftInferenceOptions,
): Promise<StftInferenceRuntime> => {
  const {
    label,
    model,
    frameShader,
    overlapAddShader,
    normalizedPeak,
    createCore,
  } = options;
  const { nFft, hop, channels, chunkSamples, frames } = model;
  const pad = nFft / 2;
  const windowCount = channels * frames;
  const chunkFloats = channels * chunkSamples;
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  const spectrumBytes =
    windowCount * (nFft + 2) * Float32Array.BYTES_PER_ELEMENT;

  configureOrtWebGpu();
  await prepareMusetricWebGpu();
  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: [
      {
        name: 'webgpu',
        storageBufferCacheMode: 'simple',
      },
    ],
    graphOptimizationLevel: options.graphOptimizationLevel ?? 'all',
    preferredOutputLocation: { [model.outputName]: 'gpu-buffer' },
    ...(options.externalData ? { externalData: options.externalData } : {}),
  });
  const webgpu = await getMusetricWebGpuDevice();
  assertStorageBufferLimit({
    actual: webgpu.maxStorageBuffersPerShaderStage,
    required:
      model.minStorageBuffersPerShaderStage ?? defaultStorageBufferLimit,
    label,
  });
  const { device } = webgpu;

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
  const scaledInput = new Float32Array(chunkFloats);

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
    await yieldGpuToCompositor();
    const scale = getInputScale(input, normalizedPeak);
    if (scale === 1) {
      device.queue.writeBuffer(rawAudio, 0, input);
    } else {
      for (let index = 0; index < chunkFloats; index += 1) {
        scaledInput[index] = input[index] * scale;
      }
      device.queue.writeBuffer(rawAudio, 0, scaledInput);
    }

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
    if (scale !== 1) {
      for (let index = 0; index < audio.length; index += 1) {
        audio[index] /= scale;
      }
    }
    await yieldGpuToCompositor();
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
