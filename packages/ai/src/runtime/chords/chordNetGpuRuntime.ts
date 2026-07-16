import {
  type Cqt,
  type CqtPlan,
  createCqt,
  getCqtFrameCount,
} from '@musetric/cqt/gpu';
import * as ort from 'onnxruntime-web/webgpu';
import { chordNetModel } from '../../models/chordNetModel.js';
import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createReadbackBuffer,
  createStorageBuffer,
  dispatch1d,
} from '../helpers.js';
import { chordPadFeaturesShader } from './padFeatures.wgsl.js';
import { chordSmoothArgmaxShader } from './smoothArgmax.wgsl.js';

ort.env.logLevel = 'error';

type ChordNetGpuState = {
  sampleCount: number;
  frameCount: number;
  windowCount: number;
  input: GPUBuffer;
  cqtOutput: GPUBuffer;
  modelInput: GPUBuffer;
  logits: GPUBuffer;
  indices: GPUBuffer;
  readback: GPUBuffer;
  cqt: Cqt;
  padPipeline: GPUComputePipeline;
  padBindGroup: GPUBindGroup;
  smoothPipeline: GPUComputePipeline;
  smoothBindGroup: GPUBindGroup;
};

const createState = (
  device: GPUDevice,
  cqtCell: ReturnType<typeof createCqt>,
  plan: CqtPlan,
  sampleCount: number,
): ChordNetGpuState => {
  const frameCount = getCqtFrameCount(sampleCount, plan);
  const windowCount = Math.ceil(frameCount / chordNetModel.sequenceLength);
  const cqtFloatCount = frameCount * chordNetModel.inputBins;
  const modelInputFloatCount =
    windowCount * chordNetModel.sequenceLength * chordNetModel.inputBins;
  const logitsFloatCount =
    windowCount * chordNetModel.sequenceLength * chordNetModel.chordCount;
  const input = createStorageBuffer(
    device,
    sampleCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const cqtOutput = createStorageBuffer(
    device,
    cqtFloatCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const modelInput = createStorageBuffer(
    device,
    modelInputFloatCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const logits = createStorageBuffer(
    device,
    logitsFloatCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const indices = createStorageBuffer(
    device,
    frameCount * Uint32Array.BYTES_PER_ELEMENT,
  );
  const readback = createReadbackBuffer(
    device,
    frameCount * Uint32Array.BYTES_PER_ELEMENT,
  );
  const cqt = cqtCell.get({
    input,
    output: cqtOutput,
    sampleCount,
    plan,
  });
  const padLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const padPipeline = createComputePipeline({
    device,
    layout: padLayout,
    code: chordPadFeaturesShader,
    constants: {
      frameCount,
      outputFloatCount: modelInputFloatCount,
      binCount: chordNetModel.inputBins,
    },
  });
  const padBindGroup = createBindGroup(device, padLayout, [
    cqtOutput,
    modelInput,
  ]);
  const smoothLayout = createBindGroupLayout(device, [
    'read-only-storage',
    'storage',
  ]);
  const smoothPipeline = createComputePipeline({
    device,
    layout: smoothLayout,
    code: chordSmoothArgmaxShader,
    constants: {
      frameCount,
      seqLen: chordNetModel.sequenceLength,
      chordCount: chordNetModel.chordCount,
      smoothingRadius: (chordNetModel.smoothingKernel - 1) / 2,
    },
  });
  const smoothBindGroup = createBindGroup(device, smoothLayout, [
    logits,
    indices,
  ]);
  return {
    sampleCount,
    frameCount,
    windowCount,
    input,
    cqtOutput,
    modelInput,
    logits,
    indices,
    readback,
    cqt,
    padPipeline,
    padBindGroup,
    smoothPipeline,
    smoothBindGroup,
  };
};

const destroyState = (state: ChordNetGpuState): void => {
  for (const buffer of [
    state.input,
    state.cqtOutput,
    state.modelInput,
    state.logits,
    state.indices,
    state.readback,
  ]) {
    buffer.destroy();
  }
};

export type ChordNetGpuRuntime = {
  analyze: (audio: Float32Array) => Promise<Int32Array>;
  release: () => Promise<void>;
};

export type ChordNetGpuRuntimeOptions = {
  modelUrl: string;
  plan: CqtPlan;
};

export const createChordNetGpuRuntime = async (
  options: ChordNetGpuRuntimeOptions,
): Promise<ChordNetGpuRuntime> => {
  const { modelUrl, plan } = options;
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    preferredOutputLocation: { [chordNetModel.outputName]: 'gpu-buffer' },
  });
  const device = await ort.env.webgpu.device;
  const cqtCell = createCqt(device);
  let state: ChordNetGpuState | undefined = undefined;

  const ensureState = (sampleCount: number): ChordNetGpuState => {
    if (state?.sampleCount === sampleCount) {
      return state;
    }
    cqtCell.dispose();
    if (state !== undefined) {
      destroyState(state);
    }
    state = createState(device, cqtCell, plan, sampleCount);
    return state;
  };

  const analyze = async (audio: Float32Array): Promise<Int32Array> => {
    const current = ensureState(audio.length);
    device.queue.writeBuffer(current.input, 0, audio);
    const cqtEncoder = device.createCommandEncoder();
    current.cqt.run(cqtEncoder);
    const padPass = cqtEncoder.beginComputePass({
      label: 'chordnet-pad-features',
    });
    dispatch1d(
      padPass,
      current.padPipeline,
      current.padBindGroup,
      current.windowCount *
        chordNetModel.sequenceLength *
        chordNetModel.inputBins,
    );
    padPass.end();
    device.queue.submit([cqtEncoder.finish()]);

    const input = ort.Tensor.fromGpuBuffer(current.modelInput, {
      dataType: 'float32',
      dims: [
        current.windowCount,
        chordNetModel.sequenceLength,
        chordNetModel.inputBins,
      ],
    });
    const output = ort.Tensor.fromGpuBuffer(current.logits, {
      dataType: 'float32',
      dims: [
        current.windowCount,
        chordNetModel.sequenceLength,
        chordNetModel.chordCount,
      ],
    });
    const result = await session.run(
      { [chordNetModel.inputName]: input },
      { [chordNetModel.outputName]: output },
    );
    const logits = result[chordNetModel.outputName];
    if (logits.gpuBuffer !== current.logits) {
      logits.dispose();
      throw new Error(
        'ChordNet output did not reuse the preallocated GPU buffer',
      );
    }

    const postEncoder = device.createCommandEncoder();
    const smoothPass = postEncoder.beginComputePass({
      label: 'chordnet-smooth-argmax',
    });
    dispatch1d(
      smoothPass,
      current.smoothPipeline,
      current.smoothBindGroup,
      current.frameCount,
    );
    smoothPass.end();
    postEncoder.copyBufferToBuffer(
      current.indices,
      0,
      current.readback,
      0,
      current.frameCount * Uint32Array.BYTES_PER_ELEMENT,
    );
    device.queue.submit([postEncoder.finish()]);
    await current.readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint32Array(current.readback.getMappedRange());
    const indices = Int32Array.from(mapped);
    current.readback.unmap();
    return indices;
  };

  const release = async (): Promise<void> => {
    cqtCell.dispose();
    if (state !== undefined) {
      destroyState(state);
      state = undefined;
    }
    await session.release();
  };

  return { analyze, release };
};
