import { type InitOutput } from '@musetric/dsp/capture';
import { type TimedMicrophoneChunk } from './protocol.cross.js';
import { createSampleRing } from './sampleRing.cross.js';

const anchorCount = 15;
const steerSeconds = 4;
const maxCorrection = 0.002;
const resyncSeconds = 0.005;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

export type TimedMicrophoneRuntime = {
  push: (chunk: TimedMicrophoneChunk) => void;
  process: (output: Float32Array, currentFrame: number) => void;
};

export const createTimedMicrophoneRuntime = (
  capture: InitOutput,
  sampleRate: number,
  onReady: () => void,
): TimedMicrophoneRuntime => {
  const ring = createSampleRing(capture);
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
      if (chunk.sampleRate / sampleRate !== step) {
        step = chunk.sampleRate / sampleRate;
        ring.setStep(step);
      }
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
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- the ring makes its output view again only when the capture's memory grows or a quantum changes its length
      position = ring.render(output, position ?? 0, ratio);
      if (!ready && firstFrame !== undefined && position >= firstFrame) {
        ready = true;
        // eslint-disable-next-line musetric/no-audio-thread-allocations -- once, when playback reaches the first captured frame
        onReady();
      }
    },
  };
};
