import { type PitchPlan } from './schedule.es.js';
import { pitchSlotBytes } from './state.js';

type SpanUpload = {
  plan: PitchPlan;
  samples: Float32Array;
  availableSamples: number;
};

export const uploadSpans = (
  device: GPUDevice,
  target: GPUBuffer,
  upload: SpanUpload,
): void => {
  const { plan, samples, availableSamples } = upload;
  const last = plan.spans.at(-1);
  if (!last) {
    return;
  }
  const staging = new Float32Array(last.spanOffset + last.length);
  const end = Math.min(samples.length, availableSamples);
  for (const span of plan.spans) {
    const from = Math.max(0, span.sampleStart);
    const to = Math.min(end, span.sampleStart + span.length);
    if (to > from) {
      staging.set(
        samples.subarray(from, to),
        span.spanOffset + from - span.sampleStart,
      );
    }
  }
  device.queue.writeBuffer(target, 0, staging);
};

export const uploadSlots = (
  device: GPUDevice,
  target: GPUBuffer,
  plan: PitchPlan,
): void => {
  if (plan.slots.length === 0) {
    return;
  }
  const table = new Int32Array((plan.slots.length * pitchSlotBytes) / 4);
  plan.slots.forEach((slot, index) => {
    table[index * 4] = slot.frame;
    table[index * 4 + 1] = slot.spanOffset;
    table[index * 4 + 2] = slot.predecessor;
    table[index * 4 + 3] = slot.observe ? 1 : 0;
  });
  device.queue.writeBuffer(target, 0, table);
};
