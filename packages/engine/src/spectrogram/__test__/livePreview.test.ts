import { describe, expect, it } from 'vitest';
import { loadTestCapture } from '../../audioSession/__test__/captureModule.js';
import {
  type ContextPreview,
  createLivePreview,
} from '../livePreview.cross.js';

const contextRate = 48000;
const microphoneRate = 44100;
const chunkFrames = 441;
const frequency = 1000;

const tone = (start: number, length: number) =>
  Float32Array.from({ length }, (_, index) =>
    Math.sin((2 * Math.PI * frequency * (start + index)) / microphoneRate),
  );

const chunkAt = (index: number, startMs = 0) => ({
  capturedAt: startMs + index * 10,
  sampleRate: microphoneRate,
  samples: tone(index * chunkFrames, chunkFrames),
});

describe('live preview', () => {
  it('passes a chunk at the context rate through', () => {
    const convert = createLivePreview(loadTestCapture(), contextRate);
    const samples = Float32Array.from([0.1, 0.2, 0.3]);
    expect(
      convert({ capturedAt: 5, sampleRate: contextRate, samples }),
    ).toEqual({ capturedAt: 5, samples });
  });

  it('converts a run of chunks to the context rate without seams', () => {
    const convert = createLivePreview(loadTestCapture(), contextRate);
    const previews: ContextPreview[] = [];
    for (let index = 0; index < 50; index += 1) {
      const preview = convert(chunkAt(index));
      if (preview) {
        previews.push(preview);
      }
    }
    let largest = 0;
    let frames = 0;
    for (const preview of previews) {
      preview.samples.forEach((value, offset) => {
        const seconds = preview.capturedAt / 1000 + offset / contextRate;
        if (seconds > 0.01) {
          const expected = Math.sin(2 * Math.PI * frequency * seconds);
          largest = Math.max(largest, Math.abs(value - expected));
        }
      });
      frames += preview.samples.length;
    }
    expect(largest).toBeLessThan(1e-3);
    expect(Math.abs(frames - 0.5 * contextRate)).toBeLessThan(40);
  });

  it('starts a new run after a gap', () => {
    const convert = createLivePreview(loadTestCapture(), contextRate);
    for (let index = 0; index < 5; index += 1) {
      convert(chunkAt(index));
    }
    const after = convert(chunkAt(0, 1000));
    expect(after?.capturedAt).toBe(1000);
  });
});
