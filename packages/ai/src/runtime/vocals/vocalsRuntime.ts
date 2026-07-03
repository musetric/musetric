import {
  createFftPackedStockhamR2c,
  createIfftPackedStockhamC2r,
} from '@musetric/fft/gpu';
import * as ort from 'onnxruntime-web/webgpu';
import { vocalsModel } from '../../models/vocalsModel.js';
import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createReadbackBuffer,
  createStorageBuffer,
  dispatch1d,
  dispatch2d,
} from '../helpers.js';
import { vocalsApplyMasksShader } from './applyMasks.wgsl.js';
import { vocalsFrameShader } from './frame.wgsl.js';
import { vocalsOverlapAddShader } from './overlapAdd.wgsl.js';
import { vocalsPackShader } from './pack.wgsl.js';

ort.env.logLevel = 'error';

// WebGPU host stages around the Mel-Band RoFormer / SYHFT ONNX core.
// See thirdPartyNotices.md for source and license details.
export type VocalsProcessChunkOptions = {
  input: Float32Array<ArrayBuffer>;
  output: Float32Array<ArrayBuffer>;
};

export type VocalsGpuRuntime = {
  processChunk: (options: VocalsProcessChunkOptions) => Promise<void>;
  release: () => Promise<void>;
};

export type VocalsGpuRuntimeOptions = {
  modelUrl: string;
  modelDataUrl: string;
  modelDataPath: string;
};

export const createVocalsGpuRuntime = async (
  options: VocalsGpuRuntimeOptions,
): Promise<VocalsGpuRuntime> => {
  const { nFft, hop, frames, channels, chunkSamples } = vocalsModel;
  const pad = nFft / 2;
  const packedBins = (nFft / 2 + 1) * 2;
  const windowCount = channels * frames;
  const chunkFloats = channels * chunkSamples;
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  const spectrumBytes =
    windowCount * (nFft + 2) * Float32Array.BYTES_PER_ELEMENT;
  const modelBytes = packedBins * frames * 2 * Float32Array.BYTES_PER_ELEMENT;

  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    preferredOutputLocation: { [vocalsModel.outputName]: 'gpu-buffer' },
    externalData: [{ path: options.modelDataPath, data: options.modelDataUrl }],
  });
  const device = await ort.env.webgpu.device;

  const frameLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const framePipeline = createComputePipeline({
    device,
    layout: frameLayout,
    code: vocalsFrameShader,
    constants: { nFft, hop, pad, frames, windowCount, samples: chunkSamples },
  });
  const packLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const packPipeline = createComputePipeline({
    device,
    layout: packLayout,
    code: vocalsPackShader,
    constants: { nFft, frames, packedBins },
  });
  const applyMasksLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'read-only-storage',
    'storage',
  ]);
  const applyMasksPipeline = createComputePipeline({
    device,
    layout: applyMasksLayout,
    code: vocalsApplyMasksShader,
    constants: { nFft, frames, packedBins },
  });
  const overlapAddLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const overlapAddPipeline = createComputePipeline({
    device,
    layout: overlapAddLayout,
    code: vocalsOverlapAddShader,
    constants: { nFft, hop, pad, frames, channels, samples: chunkSamples },
  });

  const fftCell = createFftPackedStockhamR2c(device);
  const ifftCell = createIfftPackedStockhamC2r(device);
  const rawAudio = createStorageBuffer(device, chunkBytes);
  const wave = createStorageBuffer(device, spectrumBytes);
  const stft = createStorageBuffer(device, modelBytes);
  const masks = createStorageBuffer(device, modelBytes);
  const spectrum = createStorageBuffer(device, spectrumBytes);
  const frameTime = createStorageBuffer(
    device,
    windowCount * nFft * Float32Array.BYTES_PER_ELEMENT,
  );
  const outputAudio = createStorageBuffer(device, chunkBytes);
  const readback = createReadbackBuffer(device, chunkBytes);

  const frameBindGroup = createBindGroup(device, frameLayout, [rawAudio, wave]);
  const packBindGroup = createBindGroup(device, packLayout, [wave, stft]);
  const applyMasksBindGroup = createBindGroup(device, applyMasksLayout, [
    stft,
    masks,
    spectrum,
  ]);
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
  const masksOutput = ort.Tensor.fromGpuBuffer(masks, {
    dataType: 'float32',
    dims: [...vocalsModel.outputShape],
  });

  const processChunk = async (
    chunkOptions: VocalsProcessChunkOptions,
  ): Promise<void> => {
    const { input, output } = chunkOptions;
    if (input.length !== chunkFloats || output.length !== chunkFloats) {
      throw new Error(`Vocals chunk must contain ${chunkFloats} floats`);
    }

    device.queue.writeBuffer(rawAudio, 0, input);
    const stftEncoder = device.createCommandEncoder();
    const framePass = stftEncoder.beginComputePass();
    dispatch2d({
      pass: framePass,
      pipeline: framePipeline,
      bindGroup: frameBindGroup,
      x: nFft,
      y: windowCount,
    });
    framePass.end();
    fft.run(stftEncoder);
    const packPass = stftEncoder.beginComputePass();
    dispatch2d({
      pass: packPass,
      pipeline: packPipeline,
      bindGroup: packBindGroup,
      x: packedBins,
      y: frames,
    });
    packPass.end();
    device.queue.submit([stftEncoder.finish()]);

    const inputTensor = ort.Tensor.fromGpuBuffer(stft, {
      dataType: 'float32',
      dims: [...vocalsModel.inputShape],
    });
    const result = await session.run(
      { [vocalsModel.inputName]: inputTensor },
      { [vocalsModel.outputName]: masksOutput },
    );
    const masksTensor = result[vocalsModel.outputName];
    if (masksTensor.gpuBuffer !== masks) {
      masksTensor.dispose();
      throw new Error(
        'Vocals model output did not reuse the preallocated GPU buffer',
      );
    }

    const istftEncoder = device.createCommandEncoder();
    const applyMasksPass = istftEncoder.beginComputePass();
    dispatch2d({
      pass: applyMasksPass,
      pipeline: applyMasksPipeline,
      bindGroup: applyMasksBindGroup,
      x: packedBins,
      y: frames,
    });
    applyMasksPass.end();
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
    output.set(new Float32Array(readback.getMappedRange()));
    readback.unmap();
  };

  const release = async (): Promise<void> => {
    fftCell.dispose();
    ifftCell.dispose();
    for (const buffer of [
      rawAudio,
      wave,
      stft,
      masks,
      spectrum,
      frameTime,
      outputAudio,
      readback,
    ]) {
      buffer.destroy();
    }
    await session.release();
  };

  return { processChunk, release };
};
