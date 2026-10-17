import { nativeMicrophoneDelaySeconds } from './protocol.cross.js';
import { createSampleRing } from './sampleRing.worklet.js';

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
  push: (frame: number, samples: Float32Array) => void;
  reset: () => void;
  process: (output: Float32Array) => void;
};

export const createNativeMicrophoneRuntime = (
  sampleRate: number,
  onReady: () => void,
): NativeMicrophoneRuntime => {
  const ring = createSampleRing();
  const delay = Math.round(nativeMicrophoneDelaySeconds * sampleRate);
  const bucketFrames = Math.round(bucketSeconds * sampleRate);
  const windowFrames = Math.round(windowSeconds * sampleRate);
  const warmupFrames = Math.round(warmupSeconds * sampleRate);
  const resyncFrames = Math.round(resyncSeconds * sampleRate);
  const steerFrames = steerSeconds * sampleRate;
  let buckets: LatenessBucket[] = [];
  let clock = 0;
  let position: number | undefined = undefined;
  let startClock = 0;
  let ready = false;
  let ratio = 1;

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
    if (!ready || Math.abs(error) > resyncFrames) {
      position = target;
      ratio = 1;
      return;
    }
    const correction = error / steerFrames;
    ratio = 1 + Math.max(-maxCorrection, Math.min(maxCorrection, correction));
  };

  return {
    push: (frame, samples) => {
      if (samples.length === 0) {
        return;
      }
      ring.write(frame, samples);
      const lowest = trackLateness(clock - frame - samples.length);
      steer(clock - lowest - delay);
    },
    reset: () => {
      ring.clear();
      buckets = [];
      position = undefined;
      ready = false;
      ratio = 1;
    },
    process: (output) => {
      clock += output.length;
      if (position === undefined) {
        output.fill(0);
        return;
      }
      let at = position;
      for (let index = 0; index < output.length; index += 1) {
        output[index] = ring.sampleAt(at);
        at += ratio;
      }
      position = at;
      if (!ready && clock - startClock >= warmupFrames) {
        ready = true;
        onReady();
      }
    },
  };
};
