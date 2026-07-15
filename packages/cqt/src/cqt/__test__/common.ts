import { createGpuBufferReader } from '@musetric/utils/gpu';
import { expect } from 'vitest';
import { createCqt } from '../cell.js';
import { getCqtFrameCount } from '../frameCount.es.js';
import { getReferencePlan, referenceCqtConfig } from './plan.js';

export const logFloor = 1e-6;

export const getMagnitudes = (logValues: Float32Array): Float32Array =>
  logValues.map((value) => Math.exp(value) - logFloor);

export const getPeak = (values: Float32Array): number => {
  let peak = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
  }
  return peak;
};

export const getPeakBin = (row: Float32Array): number => {
  let peakBin = 0;
  for (let bin = 1; bin < row.length; bin++) {
    if (row[bin] > row[peakBin]) {
      peakBin = bin;
    }
  }
  return peakBin;
};

export type CqtResult = {
  log: Float32Array;
  frameCount: number;
  getRow: (frameIndex: number) => Float32Array;
};

export const runCqt = async (
  device: GPUDevice,
  samples: Float32Array,
): Promise<CqtResult> => {
  const plan = getReferencePlan();
  const { nBins } = referenceCqtConfig;
  const frameCount = getCqtFrameCount(samples.length, plan);
  const input = device.createBuffer({
    label: 'test-cqt-input',
    size: samples.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const output = device.createBuffer({
    label: 'test-cqt-output',
    size: frameCount * nBins * Float32Array.BYTES_PER_ELEMENT,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  const cqtCell = createCqt(device);
  const reader = createGpuBufferReader({
    device,
    typeSize: Float32Array.BYTES_PER_ELEMENT,
    size: frameCount * nBins,
  });
  try {
    const cqt = cqtCell.get({
      input,
      output,
      sampleCount: samples.length,
      plan,
    });
    expect(cqt.frameCount).toBe(frameCount);
    device.queue.writeBuffer(input, 0, samples);
    const encoder = device.createCommandEncoder();
    cqt.run(encoder);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const log = new Float32Array(await reader.read(output));
    return {
      log,
      frameCount,
      getRow: (frameIndex) =>
        log.slice(frameIndex * nBins, (frameIndex + 1) * nBins),
    };
  } finally {
    reader.destroy();
    cqtCell.dispose();
    input.destroy();
    output.destroy();
  }
};

export const assertArrayClose = (
  name: string,
  received: Float32Array,
  expected: Float32Array,
  tolerance: number,
): void => {
  expect(received, `${name} length`).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(
      Math.abs(received[index] - expected[index]),
      `${name} index ${index}: ${received[index]} vs ${expected[index]}`,
    ).toBeLessThanOrEqual(tolerance);
  }
};
