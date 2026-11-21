import { describe, expect, it } from 'vitest';
import { createNativeMicrophoneRuntime } from '../nativeMicrophoneRuntime.worklet.js';
import { nativeMicrophoneDelaySeconds } from '../protocol.cross.js';
import { loadTestCapture } from './captureModule.js';

const rate = 48000;
const blockSize = 128;
const delay = Math.round(nativeMicrophoneDelaySeconds * rate);

const createRamp = (frame: number, length: number) =>
  Float32Array.from({ length }, (_, index) => frame + index);

const createTone = (
  frequency: number,
  sampleRate: number,
  frame: number,
  length: number,
) =>
  Float32Array.from({ length }, (_, index) =>
    Math.sin((2 * Math.PI * frequency * (frame + index)) / sampleRate),
  );

const ignoreReady = () => undefined;

type Simulation = {
  seconds: number;
  clockRatio: number;
  chunkSize: number;
  microphoneRate?: number;
  stall?: { at: number; frames: number };
};

const simulate = (simulation: Simulation) => {
  const runtime = createNativeMicrophoneRuntime(
    loadTestCapture(),
    rate,
    ignoreReady,
  );
  const microphoneRate = simulation.microphoneRate ?? rate;
  const step = microphoneRate / rate;
  const blocks = Math.round((simulation.seconds * rate) / blockSize);
  const positions: number[] = [];
  const pending: Float32Array[] = [];
  let produced = 0;
  let sent = 0;
  let stallUntil = -1;
  for (let block = 0; block < blocks; block += 1) {
    const now = block * blockSize;
    const target = Math.floor(now * simulation.clockRatio * step);
    while (produced + simulation.chunkSize <= target) {
      pending.push(createRamp(produced, simulation.chunkSize));
      produced += simulation.chunkSize;
    }
    if (simulation.stall && now >= simulation.stall.at && stallUntil < 0) {
      stallUntil = now + simulation.stall.frames;
    }
    if (now >= stallUntil) {
      for (const samples of pending.splice(0)) {
        runtime.push({ frame: sent, sampleRate: microphoneRate, samples });
        sent += samples.length;
      }
    }
    const output = new Float32Array(blockSize);
    runtime.process(output);
    positions.push(output[blockSize - 1]);
  }
  return { positions, blocks, step };
};

describe('native microphone runtime', () => {
  it('delays samples by a constant number of frames', () => {
    let readyCount = 0;
    const runtime = createNativeMicrophoneRuntime(
      loadTestCapture(),
      rate,
      () => {
        readyCount += 1;
      },
    );
    const chunkSize = blockSize * 8;
    const output = new Float32Array(blockSize);
    const played: number[] = [];
    for (let chunk = 0; chunk < 40; chunk += 1) {
      runtime.push({
        frame: chunk * chunkSize,
        sampleRate: rate,
        samples: createRamp(chunk * chunkSize, chunkSize),
      });
      for (let block = 0; block < 8; block += 1) {
        runtime.process(output);
        played.push(...output);
      }
    }
    const firstChunkEnd = chunkSize;
    for (let index = delay; index < played.length; index += 1) {
      expect(played[index]).toBe(index + firstChunkEnd - delay);
    }
    expect(readyCount).toBe(1);
  });

  it('anchors to the least late chunk after a slow start', () => {
    const { positions, blocks } = simulate({
      seconds: 3,
      clockRatio: 1,
      chunkSize: 960,
      stall: { at: 0, frames: Math.round(rate * 0.1) },
    });
    for (let index = Math.round(blocks / 2); index < blocks; index += 1) {
      const produced = index * blockSize;
      const lag = produced - positions[index];
      expect(lag).toBeGreaterThan(delay - 1000);
      expect(lag).toBeLessThan(delay + 1000);
    }
  });

  it('keeps the delay when the microphone clock runs faster', () => {
    const { positions, blocks } = simulate({
      seconds: 120,
      clockRatio: 1.0002,
      chunkSize: 960,
    });
    const tail = positions.slice(Math.round(blocks * 0.75));
    for (const [offset, position] of tail.entries()) {
      const index = Math.round(blocks * 0.75) + offset;
      const produced = Math.floor(index * blockSize * 1.0002);
      const lag = produced - position;
      expect(lag).toBeGreaterThan(delay - 1000);
      expect(lag).toBeLessThan(delay + 1000);
    }
  });

  it.each([44100, 96000])(
    'keeps the delay with a microphone at %i Hz',
    (microphoneRate) => {
      const clockRatio = 1.0002;
      const { positions, blocks, step } = simulate({
        seconds: 120,
        clockRatio,
        chunkSize: microphoneRate / 100,
        microphoneRate,
      });
      const from = Math.round(blocks * 0.75);
      for (const [offset, position] of positions.slice(from).entries()) {
        const index = from + offset;
        const produced = Math.floor(index * blockSize * clockRatio * step);
        const lag = (produced - position) / step;
        expect(lag).toBeGreaterThan(delay - 1000);
        expect(lag).toBeLessThan(delay + 1000);
      }
      const advance = positions[blocks - 1] - positions[from];
      const elapsed = (blocks - 1 - from) * blockSize * step;
      expect(Math.abs(advance / elapsed - clockRatio)).toBeLessThan(1e-4);
    },
  );

  it('drops what a faster microphone carries above the context Nyquist', () => {
    const microphoneRate = 96000;
    const chunkSize = blockSize * 12;
    const runtime = createNativeMicrophoneRuntime(
      loadTestCapture(),
      rate,
      ignoreReady,
    );
    const output = new Float32Array(blockSize);
    let loudest = 0;
    for (let chunk = 0; chunk < 200; chunk += 1) {
      runtime.push({
        frame: chunk * chunkSize,
        sampleRate: microphoneRate,
        samples: createTone(
          36000,
          microphoneRate,
          chunk * chunkSize,
          chunkSize,
        ),
      });
      for (let block = 0; block < 6; block += 1) {
        runtime.process(output);
        if (chunk >= 100) {
          loudest = Math.max(loudest, ...output.map(Math.abs));
        }
      }
    }
    expect(loudest).toBeLessThan(1e-3);
  });

  it('keeps the timeline across a delivery stall', () => {
    const stallFrames = Math.round(rate * 0.4);
    const stallAt = rate * 5;
    const { positions } = simulate({
      seconds: 10,
      clockRatio: 1,
      chunkSize: 960,
      stall: { at: stallAt, frames: stallFrames },
    });
    const before = positions[Math.floor(stallAt / blockSize) - 1];
    const after = positions[positions.length - 1];
    const elapsed = positions.length * blockSize - stallAt;
    expect(Math.abs(after - before - elapsed)).toBeLessThan(2 * blockSize);
  });
});
