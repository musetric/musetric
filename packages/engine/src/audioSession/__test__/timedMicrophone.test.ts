import { describe, expect, it } from 'vitest';
import { createTimedMicrophoneRuntime } from '../timedMicrophoneRuntime.worklet.js';

const rate = 48000;
const blockSize = 128;
const chunkSize = 1920;
const delay = 0.45 * rate;
const captureStart = 4800;
const deliveryFrames = 0.08 * rate;

const spread = (index: number) => ((index * 3) % 5) / 2 - 1;

type Simulation = {
  seconds: number;
  sourceRate?: number;
  clockRatio?: number;
  jitterFrames?: number;
  shift?: { from: number; frames: number };
  lateChunk?: number;
  onReady?: () => void;
};

type Played = {
  frame: number;
  value: number;
  expected: number;
};

const simulate = (simulation: Simulation) => {
  const sourceRate = simulation.sourceRate ?? rate;
  const capturedRate = sourceRate * (simulation.clockRatio ?? 1);
  const jitterFrames = simulation.jitterFrames ?? 0;
  const { shift } = simulation;
  const runtime = createTimedMicrophoneRuntime(
    rate,
    simulation.onReady ?? (() => undefined),
  );
  const shiftAt = (frame: number) =>
    shift && frame >= shift.from ? shift.frames : 0;
  const captureFrame = (sourceFrame: number) => {
    const frame = captureStart + (sourceFrame * rate) / capturedRate;
    return frame + shiftAt(frame);
  };
  const chunks = Array.from(
    { length: Math.ceil((simulation.seconds * capturedRate) / chunkSize) },
    (_, index) => {
      const frame = index * chunkSize;
      const late = index === simulation.lateChunk ? delay : 0;
      return {
        frame,
        at: captureFrame(frame) + delay + jitterFrames * spread(index),
        deliveredAt: captureFrame(frame + chunkSize) + deliveryFrames + late,
      };
    },
  );
  const played: Played[] = [];
  const blocks = Math.round((simulation.seconds * rate) / blockSize);
  let next = 0;
  const pending = chunks.toSorted(
    (left, right) => left.deliveredAt - right.deliveredAt,
  );
  for (let block = 0; block < blocks; block += 1) {
    const currentFrame = block * blockSize;
    while (next < pending.length && pending[next].deliveredAt <= currentFrame) {
      const chunk = pending[next];
      runtime.push({
        frame: chunk.frame,
        at: chunk.at,
        sampleRate: sourceRate,
        samples: Float32Array.from(
          { length: chunkSize },
          (_, index) => chunk.frame + index,
        ),
      });
      next += 1;
    }
    const output = new Float32Array(blockSize);
    runtime.process(output, currentFrame);
    const frame = currentFrame + blockSize - 1;
    const captured = frame - delay;
    played.push({
      frame,
      value: output[blockSize - 1],
      expected:
        ((captured - captureStart - shiftAt(captured)) * capturedRate) / rate,
    });
  }
  return played;
};

const largestError = (played: Played[], fromSeconds: number) =>
  Math.max(
    ...played
      .filter((sample) => sample.frame >= fromSeconds * rate)
      .map((sample) => Math.abs(sample.value - sample.expected)),
  );

const meanError = (played: Played[], fromSeconds: number) => {
  const errors = played
    .filter((sample) => sample.frame >= fromSeconds * rate)
    .map((sample) => sample.value - sample.expected);
  return errors.reduce((sum, error) => sum + error, 0) / errors.length;
};

describe('timed microphone runtime', () => {
  it('plays a sample at the frame given for its capture time', () => {
    const played = simulate({ seconds: 3 });
    expect(largestError(played, 1)).toBeLessThan(0.01);
  });

  it('stays within a millisecond of jittered capture times', () => {
    const played = simulate({ seconds: 6, jitterFrames: rate / 1000 });
    expect(largestError(played, 1)).toBeLessThan(rate / 1000);
    expect(Math.abs(meanError(played, 1))).toBeLessThan(rate / 10000);
  });

  it('converts a microphone at another sample rate', () => {
    const played = simulate({ seconds: 6, sourceRate: 44100 });
    expect(largestError(played, 1)).toBeLessThan(0.05);
  });

  it('follows a microphone clock that drifts from the output clock', () => {
    const played = simulate({ seconds: 20, clockRatio: 1.0001 });
    expect(largestError(played, 2)).toBeLessThan(rate / 1000);
  });

  it('jumps to an output clock re-estimated by 10 ms', () => {
    const played = simulate({
      seconds: 4,
      shift: { from: 2 * rate, frames: 0.01 * rate },
    });
    expect(largestError(played, 2.5)).toBeLessThan(0.05);
  });

  it('leaves silence for a late chunk and keeps the next ones on time', () => {
    const lateChunk = 40;
    const played = simulate({ seconds: 4, lateChunk });
    const lateFrom = captureStart + lateChunk * chunkSize + delay;
    const late = played.filter(
      (sample) =>
        sample.frame >= lateFrom + blockSize &&
        sample.frame < lateFrom + chunkSize - blockSize,
    );
    expect(late.every((sample) => sample.value === 0)).toBe(true);
    const after = played.filter(
      (sample) => sample.frame >= lateFrom + chunkSize + blockSize,
    );
    expect(largestError(after, 0)).toBeLessThan(0.01);
  });

  it('reports ready once the first captured sample plays', () => {
    let readyCount = 0;
    simulate({
      seconds: 1,
      onReady: () => {
        readyCount += 1;
      },
    });
    expect(readyCount).toBe(1);
  });
});
