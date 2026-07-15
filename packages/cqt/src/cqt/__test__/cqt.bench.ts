import { createGpuContext } from '@musetric/utils/gpu';
import { afterAll, bench, describe } from 'vitest';
import { createCqt } from '../cell.js';
import { getCqtFrameCount } from '../frameCount.es.js';
import { getReferencePlan, referenceCqtConfig } from './plan.js';

const sampleCount = referenceCqtConfig.sampleRate * 10;
const { device } = await createGpuContext();
const plan = getReferencePlan();
const input = device.createBuffer({
  label: 'cqt-bench-10s-input',
  size: sampleCount * Float32Array.BYTES_PER_ELEMENT,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const output = device.createBuffer({
  label: 'cqt-bench-10s-output',
  size:
    getCqtFrameCount(sampleCount, plan) *
    referenceCqtConfig.nBins *
    Float32Array.BYTES_PER_ELEMENT,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const cqtCell = createCqt(device);
const cqt = cqtCell.get({
  input,
  output,
  sampleCount,
  plan,
});

const samples = new Float32Array(sampleCount);
for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
  const time = sampleIndex / referenceCqtConfig.sampleRate;
  samples[sampleIndex] =
    Math.sin(time * Math.PI * 220) * 0.7 +
    Math.sin(time * Math.PI * 659.26) * 0.2;
}
device.queue.writeBuffer(input, 0, samples);

const runCqt = async (): Promise<void> => {
  const encoder = device.createCommandEncoder({ label: 'cqt-bench-10s' });
  cqt.run(encoder);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
};

await runCqt();

afterAll(() => {
  cqtCell.dispose();
  output.destroy();
  input.destroy();
});

describe('CQT benchmarks', () => {
  bench('warm 10 s CQT', async () => {
    await runCqt();
  });
});
