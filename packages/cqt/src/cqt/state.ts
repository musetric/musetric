import { createFftPackedStockhamR2c } from '@musetric/fft/gpu';
import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { downsampleShader } from '../resample/downsample.wgsl.js';
import { cqtFrameShader } from './frame.wgsl.js';
import {
  getCqtFrameCount,
  getDownsampledSampleCount,
} from './frameCount.es.js';
import {
  type ComputeStage,
  createBindGroup,
  createComputePipeline,
  createStorageBuffer,
  createUniformBuffer,
  runStage,
} from './gpu.js';
import {
  createDownsampleParams,
  createFrameParams,
  createProjectParams,
} from './params.js';
import { validateCqtPlan } from './plan.es.js';
import { cqtProjectShader } from './project.wgsl.js';
import { type Cqt, type CqtArg, type CqtTimestampWrites } from './types.js';

const cqtFrameFftSize = 512;

const validateArg = (arg: CqtArg): void => {
  validateCqtPlan(arg.plan);
  if (!Number.isSafeInteger(arg.sampleCount) || arg.sampleCount < 2) {
    throw new RangeError(
      'CQT requires at least two PCM samples for early downsampling',
    );
  }
  if (arg.plan.octaves.some((octave) => octave.fftSize !== cqtFrameFftSize)) {
    throw new RangeError('Only 512-point CQT plans are supported');
  }
};

type State = {
  cqt: Cqt;
  destroy: () => void;
};

const createState = (
  device: GPUDevice,
  markers: CqtTimestampWrites | undefined,
  arg: CqtArg,
): State => {
  validateArg(arg);
  const { plan, sampleCount, input, output } = arg;
  const { config } = plan;
  const frameCount = getCqtFrameCount(sampleCount, plan);
  const levelCount = plan.earlyDownsampleCount + plan.octaves.length - 1;
  const sampleCounts: number[] = [];
  let nextSampleCount = sampleCount;
  for (let level = 0; level < levelCount; level++) {
    nextSampleCount = getDownsampledSampleCount(nextSampleCount);
    sampleCounts.push(nextSampleCount);
  }
  const largestLevelByteLength =
    sampleCounts[0] * Float32Array.BYTES_PER_ELEMENT;
  const fftByteLength =
    frameCount * (cqtFrameFftSize + 2) * Float32Array.BYTES_PER_ELEMENT;
  const outputByteLength =
    frameCount * config.nBins * Float32Array.BYTES_PER_ELEMENT;
  if (outputByteLength > device.limits.maxStorageBufferBindingSize) {
    throw new RangeError(
      `CQT output needs ${outputByteLength} bytes but this device caps a ` +
        `storage buffer at ${device.limits.maxStorageBufferBindingSize}`,
    );
  }

  const levelA = createStorageBuffer(
    device,
    'cqt-downsample-level-a',
    largestLevelByteLength,
  );
  const levelB = createStorageBuffer(
    device,
    'cqt-downsample-level-b',
    largestLevelByteLength,
  );
  const fftBuffer = createStorageBuffer(
    device,
    'cqt-fft-buffer',
    fftByteLength,
  );
  const rowOffsets = createStorageBuffer(
    device,
    'cqt-row-offsets',
    plan.rowOffsets.byteLength,
  );
  const fftBins = createStorageBuffer(
    device,
    'cqt-fft-bins',
    plan.fftBins.byteLength,
  );
  const coefficients = createStorageBuffer(
    device,
    'cqt-projection-coefficients',
    plan.coefficients.byteLength,
  );
  const halfCoefficients = createStorageBuffer(
    device,
    'cqt-downsample-coefficients',
    plan.downsample.halfCoefficients.byteLength,
  );
  device.queue.writeBuffer(rowOffsets, 0, plan.rowOffsets);
  device.queue.writeBuffer(fftBins, 0, plan.fftBins);
  device.queue.writeBuffer(coefficients, 0, plan.coefficients);
  device.queue.writeBuffer(
    halfCoefficients,
    0,
    plan.downsample.halfCoefficients,
  );

  const downsamplePipeline = createComputePipeline(
    device,
    'cqt-downsample-pipeline',
    downsampleShader,
  );
  const framePipeline = createComputePipeline(
    device,
    'cqt-frame-pipeline',
    cqtFrameShader,
  );
  const projectPipeline = createComputePipeline(
    device,
    'cqt-project-pipeline',
    cqtProjectShader,
  );
  const ownedBuffers: GPUBuffer[] = [
    levelA,
    levelB,
    fftBuffer,
    rowOffsets,
    fftBins,
    coefficients,
    halfCoefficients,
  ];

  const downsampleStages: ComputeStage[] = [];
  let source: GPUBuffer = input;
  let sourceCount = sampleCount;
  for (let level = 0; level < levelCount; level++) {
    const target = level % 2 === 0 ? levelA : levelB;
    const targetCount = sampleCounts[level];
    const params = createUniformBuffer(
      device,
      `cqt-downsample-${level}-params`,
      createDownsampleParams({
        inputCount: sourceCount,
        outputCount: targetCount,
        tapCount: plan.downsample.tapCount,
        delay: plan.downsample.delay,
        gain: plan.downsample.gain,
      }),
    );
    ownedBuffers.push(params);
    downsampleStages.push({
      pipeline: downsamplePipeline,
      bindGroup: createBindGroup(device, downsamplePipeline, [
        source,
        target,
        halfCoefficients,
        params,
      ]),
      workgroupsX: Math.ceil(targetCount / 256),
    });
    source = target;
    sourceCount = targetCount;
  }

  const frameStages: ComputeStage[] = [];
  const projectStages: ComputeStage[] = [];
  for (const octave of plan.octaves) {
    const octaveInput = octave.index % 2 === 0 ? levelA : levelB;
    const octaveSamples =
      sampleCounts[plan.earlyDownsampleCount + octave.index - 1];
    const frameParams = createUniformBuffer(
      device,
      `cqt-frame-${octave.index}-params`,
      createFrameParams(
        octaveSamples,
        frameCount,
        octave.hopLength,
        octave.fftSize,
      ),
    );
    const projectParams = createUniformBuffer(
      device,
      `cqt-project-${octave.index}-params`,
      createProjectParams({
        frameCount,
        binStart: octave.binStart,
        binCount: octave.binCount,
        fftSize: octave.fftSize,
        outputBins: config.nBins,
        outputKind: config.output === 'magnitude' ? 0 : 1,
      }),
    );
    ownedBuffers.push(frameParams, projectParams);
    frameStages.push({
      pipeline: framePipeline,
      bindGroup: createBindGroup(device, framePipeline, [
        octaveInput,
        fftBuffer,
        frameParams,
      ]),
      workgroupsX: Math.ceil(octave.fftSize / 16),
      workgroupsY: Math.ceil(frameCount / 16),
    });
    projectStages.push({
      pipeline: projectPipeline,
      bindGroup: createBindGroup(device, projectPipeline, [
        fftBuffer,
        rowOffsets,
        fftBins,
        coefficients,
        output,
        projectParams,
      ]),
      workgroupsX: Math.ceil(octave.binCount / 16),
      workgroupsY: Math.ceil(frameCount / 16),
    });
  }

  const fftCell = createFftPackedStockhamR2c(device, markers?.fft);
  const fft = fftCell.get({
    wave: fftBuffer,
    spectrum: fftBuffer,
    config: { windowSize: cqtFrameFftSize, windowCount: frameCount },
  });

  const cqt: Cqt = {
    frameCount,
    run: (encoder) => {
      for (
        let octaveIndex = 0;
        octaveIndex < plan.octaves.length;
        octaveIndex++
      ) {
        if (octaveIndex === 0) {
          runStage(
            encoder,
            'cqt-early-downsample',
            downsampleStages[0],
            markers?.downsample,
          );
        } else {
          runStage(
            encoder,
            `cqt-downsample-${octaveIndex}`,
            downsampleStages[octaveIndex],
          );
        }
        runStage(
          encoder,
          `cqt-frame-${octaveIndex}`,
          frameStages[octaveIndex],
          octaveIndex === 0 ? markers?.frame : undefined,
        );
        fft.run(encoder);
        runStage(
          encoder,
          `cqt-project-${octaveIndex}`,
          projectStages[octaveIndex],
          octaveIndex === 0 ? markers?.projection : undefined,
        );
      }
    },
  };
  return {
    cqt,
    destroy: () => {
      fftCell.dispose();
      for (const buffer of ownedBuffers) {
        buffer.destroy();
      }
    },
  };
};

const equalArg = (current: CqtArg, next: CqtArg): boolean =>
  current.input === next.input &&
  current.output === next.output &&
  current.sampleCount === next.sampleCount &&
  current.plan.payloadSha256 === next.plan.payloadSha256;

export const createCqt = (
  device: GPUDevice,
  markers?: CqtTimestampWrites,
): ResourceCell<CqtArg, Cqt> => {
  const stateCell = createResourceCell<CqtArg, State>({
    create: (arg) => createState(device, markers, arg),
    dispose: (state) => state.destroy(),
    equals: equalArg,
  });
  return {
    get: (arg) => stateCell.get(arg).cqt,
    dispose: () => stateCell.dispose(),
  };
};
