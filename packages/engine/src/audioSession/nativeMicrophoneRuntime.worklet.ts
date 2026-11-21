import { type InitOutput } from '@musetric/dsp/capture';
import {
  type NativeMicrophoneChunk,
  nativeMicrophoneDelaySeconds,
} from './protocol.cross.js';
import { createSampleRing } from './sampleRing.cross.js';

const bucketSeconds = 0.5;
const windowSeconds = 3;
const warmupSeconds = 0.4;
const steerSeconds = 4;
const maxCorrection = 0.002;
const resyncSeconds = 0.5;

type LatenessBucket = {
  start: number;
  lowest: number;
};

export type NativeMicrophoneRuntime = {
  push: (chunk: NativeMicrophoneChunk) => void;
  reset: () => void;
  process: (output: Float32Array) => void;
};

export const createNativeMicrophoneRuntime = (
  capture: InitOutput,
  sampleRate: number,
  onReady: () => void,
): NativeMicrophoneRuntime => {
  const ring = createSampleRing(capture);
  const delay = Math.round(nativeMicrophoneDelaySeconds * sampleRate);
  const bucketFrames = Math.round(bucketSeconds * sampleRate);
  const windowFrames = Math.round(windowSeconds * sampleRate);
  const warmupFrames = Math.round(warmupSeconds * sampleRate);
  const resyncFrames = Math.round(resyncSeconds * sampleRate);
  const steerFrames = steerSeconds * sampleRate;
  let buckets: LatenessBucket[] = [];
  let clock = 0;
  let step = 1;
  let position: number | undefined = undefined;
  let startClock = 0;
  let ready = false;
  let correction = 1;

  const trackLateness = (lateness: number) => {
    const last = buckets.at(-1);
    if (!last || clock - last.start >= bucketFrames) {
      buckets = buckets.filter((bucket) => clock - bucket.start < windowFrames);
      buckets.push({ start: clock, lowest: lateness });
    } else {
      last.lowest = Math.min(last.lowest, lateness);
    }
    return Math.min(...buckets.map((bucket) => bucket.lowest));
  };

  const steer = (target: number) => {
    if (position === undefined) {
      position = target;
      startClock = clock;
      return;
    }
    const error = target - position;
    if (!ready || Math.abs(error) > resyncFrames * step) {
      position = target;
      correction = 1;
      return;
    }
    const relative = error / (steerFrames * step);
    correction =
      1 + Math.max(-maxCorrection, Math.min(maxCorrection, relative));
  };

  return {
    push: (chunk) => {
      const { frame, samples } = chunk;
      if (samples.length === 0) {
        return;
      }
      if (chunk.sampleRate / sampleRate !== step) {
        step = chunk.sampleRate / sampleRate;
        ring.setStep(step);
      }
      ring.write(frame, samples);
      const lowest = trackLateness(clock - (frame + samples.length) / step);
      steer((clock - lowest - delay) * step);
    },
    reset: () => {
      ring.clear();
      buckets = [];
      position = undefined;
      ready = false;
      correction = 1;
    },
    process: (output) => {
      clock += output.length;
      if (position === undefined) {
        output.fill(0);
        return;
      }
      position = ring.render(output, position, step * correction);
      if (!ready && clock - startClock >= warmupFrames) {
        ready = true;
        onReady();
      }
    },
  };
};
