import { type TimedMicrophoneChunk } from './protocol.cross.js';
import { createSampleRing } from './sampleRing.worklet.js';

const anchorCount = 15;
const steerSeconds = 4;
const maxCorrection = 0.002;
const resyncSeconds = 0.02;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

export type TimedMicrophoneRuntime = {
  push: (chunk: TimedMicrophoneChunk) => void;
  process: (output: Float32Array, currentFrame: number) => void;
};

export const createTimedMicrophoneRuntime = (
  sampleRate: number,
  onReady: () => void,
): TimedMicrophoneRuntime => {
  const ring = createSampleRing();
  const resyncFrames = resyncSeconds * sampleRate;
  const steerFrames = steerSeconds * sampleRate;
  const starts: number[] = [];
  let start: number | undefined = undefined;
  let step = 1;
  let position: number | undefined = undefined;
  let firstFrame: number | undefined = undefined;
  let ready = false;

  const steer = (target: number) => {
    const error = target - (position ?? target);
    if (
      position === undefined ||
      starts.length < anchorCount ||
      Math.abs(error) > resyncFrames * step
    ) {
      position = target;
      return step;
    }
    const correction = error / (steerFrames * step);
    return (
      step * (1 + Math.max(-maxCorrection, Math.min(maxCorrection, correction)))
    );
  };

  return {
    push: (chunk) => {
      step = chunk.sampleRate / sampleRate;
      ring.write(chunk.frame, chunk.samples);
      firstFrame ??= chunk.frame;
      starts.push(chunk.at - chunk.frame / step);
      if (starts.length > anchorCount) {
        starts.shift();
      }
      start = median(starts);
    },
    process: (output, currentFrame) => {
      if (start === undefined) {
        output.fill(0);
        return;
      }
      const ratio = steer((currentFrame - start) * step);
      let at = position ?? 0;
      for (let index = 0; index < output.length; index += 1) {
        output[index] = ring.sampleAt(at);
        at += ratio;
      }
      position = at;
      if (!ready && firstFrame !== undefined && position >= firstFrame) {
        ready = true;
        onReady();
      }
    },
  };
};
