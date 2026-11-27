import { type SpectrogramSource } from '../common/source.js';
import { type PitchPlan } from './schedule.es.js';
import { pitchSlotBytes } from './state.js';

type SpanUpload = {
  plan: PitchPlan;
  source: SpectrogramSource;
  availableSamples: number;
};

export const createSpanUploader = (device: GPUDevice, target: GPUBuffer) => {
  let silence = new Float32Array(0);
  const write = (
    data: Float32Array,
    dataStart: number,
    spanOffset: number,
    count: number,
  ) => {
    device.queue.writeBuffer(target, spanOffset * 4, data, dataStart, count);
  };
  const writeSilence = (spanOffset: number, count: number) => {
    if (silence.length < count) {
      silence = new Float32Array(count);
    }
    write(silence, 0, spanOffset, count);
  };

  return (upload: SpanUpload): void => {
    const { plan, source, availableSamples } = upload;
    const end = Math.min(source.length, availableSamples);
    let written = 0;
    for (const span of plan.spans) {
      if (span.spanOffset > written) {
        writeSilence(written, span.spanOffset - written);
      }
      const count = Math.max(0, Math.min(span.length, end - span.sampleStart));
      if (count > 0) {
        source.forEachRun(
          span.sampleStart,
          count,
          (samples, samplesStart, offset, runCount) => {
            if (samples) {
              write(samples, samplesStart, span.spanOffset + offset, runCount);
            } else {
              writeSilence(span.spanOffset + offset, runCount);
            }
          },
        );
      }
      if (span.length > count) {
        writeSilence(span.spanOffset + count, span.length - count);
      }
      written = span.spanOffset + span.length;
    }
  };
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
