import { createGpuBufferReader, createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { getReferencePlan } from '../../cqt/__test__/plan.js';
import { getDownsampledSampleCount } from '../../cqt/frameCount.es.js';
import { createDownsampleParams } from '../../cqt/params.js';
import { downsampleShader } from '../downsample.wgsl.js';

const { device } = await createGpuContext();
const plan = getReferencePlan().downsample;
const pipeline = device.createComputePipeline({
  label: 'cqt-downsample-test-pipeline',
  layout: 'auto',
  compute: {
    module: device.createShaderModule({ code: downsampleShader }),
    entryPoint: 'main',
  },
});

const createSignal = (length: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let index = 0; index < signal.length; index += 1) {
    signal[index] =
      Math.sin((index + 1) * 0.173) + Math.cos((index + 1) * 0.067) * 0.25;
  }
  return signal;
};

const downsampleOnCpu = (input: Float32Array): Float32Array => {
  const output = new Float32Array(getDownsampledSampleCount(input.length));
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const center = outputIndex * 2;
    let value = 0;
    for (let tap = 0; tap < plan.tapCount; tap += 1) {
      const sourceIndex = center + tap - plan.delay;
      if (sourceIndex >= 0 && sourceIndex < input.length) {
        const distance = Math.abs(tap - plan.delay);
        value += input[sourceIndex] * plan.halfCoefficients[distance];
      }
    }
    output[outputIndex] = value * plan.gain;
  }
  return output;
};

const expectSamplesClose = (
  actual: Float32Array,
  expected: Float32Array,
): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index], `output ${index}`).toBeCloseTo(expected[index], 5);
  }
};

const runDownsample = async (
  inputData: Float32Array,
): Promise<Float32Array> => {
  const outputCount = getDownsampledSampleCount(inputData.length);
  const input = device.createBuffer({
    label: 'cqt-downsample-test-input',
    size: inputData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const output = device.createBuffer({
    label: 'cqt-downsample-test-output',
    size: outputCount * Float32Array.BYTES_PER_ELEMENT,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  const coefficients = device.createBuffer({
    label: 'cqt-downsample-test-coefficients',
    size: plan.halfCoefficients.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const params = device.createBuffer({
    label: 'cqt-downsample-test-params',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const reader = createGpuBufferReader({
    device,
    typeSize: Float32Array.BYTES_PER_ELEMENT,
    size: outputCount,
  });

  try {
    device.queue.writeBuffer(input, 0, inputData);
    device.queue.writeBuffer(coefficients, 0, plan.halfCoefficients);
    device.queue.writeBuffer(
      params,
      0,
      createDownsampleParams({
        inputCount: inputData.length,
        outputCount,
        tapCount: plan.tapCount,
        delay: plan.delay,
        gain: plan.gain,
      }),
    );
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: coefficients } },
        { binding: 3, resource: { buffer: params } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass({ label: 'cqt-downsample-test' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(outputCount / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    return new Float32Array(await reader.read(output));
  } finally {
    reader.destroy();
    params.destroy();
    coefficients.destroy();
    output.destroy();
    input.destroy();
  }
};

describe('CQT WebGPU downsample', () => {
  it('keeps a zero signal at zero', async () => {
    const input = new Float32Array(513);
    const actual = await runDownsample(input);

    expectSamplesClose(actual, downsampleOnCpu(input));
    for (const value of actual) {
      expect(value).toBe(0);
    }
  });

  it('matches the baked FIR impulse response with constant boundaries', async () => {
    const input = new Float32Array(513);
    input[256] = 1;

    expectSamplesClose(await runDownsample(input), downsampleOnCpu(input));
  });

  it('matches the baked FIR DC response including edge transients', async () => {
    const input = new Float32Array(1024).fill(1);

    expectSamplesClose(await runDownsample(input), downsampleOnCpu(input));
  });

  it.each([512, 513])(
    'uses ceil(input / 2) for a %i-sample signal',
    async (inputCount) => {
      const input = createSignal(inputCount);
      const actual = await runDownsample(input);

      expect(actual).toHaveLength(Math.ceil(inputCount / 2));
      expectSamplesClose(actual, downsampleOnCpu(input));
    },
  );

  it.each([1, 2, 3])(
    'handles a short %i-sample input with zero extension',
    async (inputCount) => {
      const input = createSignal(inputCount);

      expectSamplesClose(await runDownsample(input), downsampleOnCpu(input));
    },
  );
});
