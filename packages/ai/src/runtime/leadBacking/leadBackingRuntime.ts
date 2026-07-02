import {
  createFftPackedStockhamR2c,
  createIfftPackedStockhamC2r,
} from '@musetric/fft/gpu';
import * as ort from 'onnxruntime-web/webgpu';
import { leadBackingModel } from '../../models/leadBackingModel.js';
import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createReadbackBuffer,
  createStorageBuffer,
  dispatch1d,
  dispatch2d,
} from '../helpers.js';
import { leadBackingFrameShader } from './frameShader.js';
import { leadBackingOverlapAddShader } from './overlapAddShader.js';
import { leadBackingPackShader } from './packShader.js';
import { leadBackingUnpackShader } from './unpackShader.js';

ort.env.logLevel = 'error';

export type LeadBackingGpuRuntime = {
  processChunk: (
    input: Float32Array<ArrayBuffer>,
  ) => Promise<Float32Array<ArrayBuffer>>;
  release: () => Promise<void>;
};

export type LeadBackingGpuRuntimeOptions = {
  modelUrl: string;
};

export const createLeadBackingGpuRuntime = async (
  options: LeadBackingGpuRuntimeOptions,
): Promise<LeadBackingGpuRuntime> => {
  const { nFft, hop, dimF, dimT, channels, chunkSamples } = leadBackingModel;
  const pad = nFft / 2;
  const freqs = nFft / 2 + 1;
  const frames = dimT;
  const windowCount = channels * frames;
  const chunkFloats = channels * chunkSamples;
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  const spectrumBytes =
    windowCount * (nFft + 2) * Float32Array.BYTES_PER_ELEMENT;
  const modelBytes = 4 * dimF * dimT * Float32Array.BYTES_PER_ELEMENT;

  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    preferredOutputLocation: { [leadBackingModel.outputName]: 'gpu-buffer' },
  });
  const device = await ort.env.webgpu.device;

  const frameLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const framePipeline = createComputePipeline({
    device,
    layout: frameLayout,
    code: leadBackingFrameShader,
    constants: { nFft, hop, pad, frames, windowCount, samples: chunkSamples },
  });
  const packLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const packPipeline = createComputePipeline({
    device,
    layout: packLayout,
    code: leadBackingPackShader,
    constants: { nFft, frames, windowCount, dimF, dimT },
  });
  const unpackLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const unpackPipeline = createComputePipeline({
    device,
    layout: unpackLayout,
    code: leadBackingUnpackShader,
    constants: { nFft, frames, windowCount, dimF, dimT, freqs },
  });
  const overlapAddLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const overlapAddPipeline = createComputePipeline({
    device,
    layout: overlapAddLayout,
    code: leadBackingOverlapAddShader,
    constants: { nFft, hop, pad, frames, channels, samples: chunkSamples },
  });

  const fftCell = createFftPackedStockhamR2c(device);
  const ifftCell = createIfftPackedStockhamC2r(device);
  const rawAudio = createStorageBuffer(device, chunkBytes);
  const wave = createStorageBuffer(device, spectrumBytes);
  const modelInput = createStorageBuffer(device, modelBytes);
  const modelOutput = createStorageBuffer(device, modelBytes);
  const spectrum = createStorageBuffer(device, spectrumBytes);
  const frameTime = createStorageBuffer(
    device,
    windowCount * nFft * Float32Array.BYTES_PER_ELEMENT,
  );
  const outputAudio = createStorageBuffer(device, chunkBytes);
  const readback = createReadbackBuffer(device, chunkBytes);

  const frameBindGroup = createBindGroup(device, frameLayout, [rawAudio, wave]);
  const packBindGroup = createBindGroup(device, packLayout, [wave, modelInput]);
  const unpackBindGroup = createBindGroup(device, unpackLayout, [
    modelOutput,
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
  const outputTensor = ort.Tensor.fromGpuBuffer(modelOutput, {
    dataType: 'float32',
    dims: [...leadBackingModel.outputShape],
  });

  const processChunk = async (
    input: Float32Array<ArrayBuffer>,
  ): Promise<Float32Array<ArrayBuffer>> => {
    if (input.length !== chunkFloats) {
      throw new Error(`Lead/backing chunk must contain ${chunkFloats} floats`);
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
      x: dimF,
      y: windowCount,
    });
    packPass.end();
    device.queue.submit([stftEncoder.finish()]);

    const inputTensor = ort.Tensor.fromGpuBuffer(modelInput, {
      dataType: 'float32',
      dims: [...leadBackingModel.inputShape],
    });
    const result = await session.run(
      { [leadBackingModel.inputName]: inputTensor },
      { [leadBackingModel.outputName]: outputTensor },
    );
    const output = result[leadBackingModel.outputName];
    if (output.gpuBuffer !== modelOutput) {
      output.dispose();
      throw new Error(
        'Lead/backing model output did not reuse the preallocated GPU buffer',
      );
    }

    const istftEncoder = device.createCommandEncoder();
    const unpackPass = istftEncoder.beginComputePass();
    dispatch2d({
      pass: unpackPass,
      pipeline: unpackPipeline,
      bindGroup: unpackBindGroup,
      x: freqs,
      y: windowCount,
    });
    unpackPass.end();
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
    const audio = new Float32Array(mapped.length);
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
      modelInput,
      modelOutput,
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
