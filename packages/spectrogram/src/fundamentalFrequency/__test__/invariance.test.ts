import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../__test__/common.js';
import { device, withProcessor } from '../../__test__/processor.fixtures.js';
import { type SpectrogramConfig, type TrackKey } from '../../config.cross.js';
import { defaultSpectrogramConfig } from '../../defaultConfig.cross.js';
import {
  type SpectrogramProcessor,
  type SpectrogramSamples,
} from '../../processor.js';
import { createPitchSettings } from '../settings.es.js';

const { sampleRate } = defaultSpectrogramConfig;
const settings = createPitchSettings(sampleRate);
const durationSeconds = 12;
const firstFrame = 200;
const frameCount = 1600;

type Note = {
  from: number;
  to: number;
  frequency: number;
  glide: number;
};

const notes: Note[] = [
  { from: 0.6, to: 2.1, frequency: 220, glide: 0 },
  { from: 2.3, to: 3.6, frequency: 330, glide: -200 },
  { from: 4.0, to: 5.8, frequency: 440, glide: 0 },
  { from: 6.4, to: 7.9, frequency: 175, glide: 300 },
  { from: 8.1, to: 9.5, frequency: 262, glide: 0 },
];

const createMelody = (): Float32Array => {
  const samples = new Float32Array(durationSeconds * sampleRate);
  let seed = 12345;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples[index] = 0.002 * (seed / 1073741824 - 1);
  }
  for (const note of notes) {
    const start = Math.round(note.from * sampleRate);
    const end = Math.round(note.to * sampleRate);
    let phase = 0;
    for (let index = start; index < end; index += 1) {
      const time = (index - start) / sampleRate;
      const progress = (index - start) / (end - start);
      const cents =
        note.glide * progress + 30 * Math.sin(2 * Math.PI * 5.5 * time);
      phase +=
        (2 * Math.PI * note.frequency * 2 ** (cents / 1200)) / sampleRate;
      const ramp = Math.min(1, (index - start) / 480, (end - index) / 480);
      let value = 0;
      for (let harmonic = 1; harmonic <= 10; harmonic += 1) {
        value += Math.sin(harmonic * phase) / harmonic;
      }
      samples[index] += 0.2 * ramp * value;
    }
  }
  return samples;
};

const pitchConfig = (
  key: TrackKey,
  width: number,
  visibleTime: number,
): SpectrogramConfig =>
  buildConfig({
    viewSize: { width, height: 8 },
    visibleTime,
    lanes: {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: false,
        showFundamental: key === 'lead',
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: key === 'recording',
        truncateAfterPlayhead: key === 'recording',
      },
    },
  });

const renderComplete = async (
  processor: SpectrogramProcessor,
  samples: SpectrogramSamples,
  progress: number,
): Promise<void> => {
  await processor.render(samples, progress);
  while (processor.hasPendingWork()) {
    await processor.render(samples, progress);
  }
};

const readFrames = async (
  processor: SpectrogramProcessor,
  key: TrackKey,
  first: number,
  count: number,
): Promise<Float32Array> => {
  const frames = await processor.readFundamentalFrames(key, first, count);
  if (!frames) {
    throw new Error('the pitch frames were not decoded');
  }
  return frames.values;
};

const decodeAlong = async (
  config: SpectrogramConfig,
  lead: Float32Array,
  path: readonly number[],
): Promise<Float32Array> =>
  withProcessor({ device, config }, async (processor) => {
    for (const seconds of path) {
      await renderComplete(processor, { lead }, seconds / durationSeconds);
    }
    return readFrames(processor, 'lead', firstFrame, frameCount);
  });

const steps = (from: number, to: number, step: number): number[] =>
  Array.from(
    { length: Math.floor(Math.abs(to - from) / step) + 1 },
    (_, index) => from + Math.sign(to - from) * step * index,
  );

const expectLineFromFrames = async (
  processor: SpectrogramProcessor,
): Promise<void> => {
  const line = await processor.readFundamentalLine('lead');
  if (!line) {
    throw new Error('the pitch line was not drawn');
  }
  const frameAt = (index: number): number =>
    Math.round(((line.baseColumn + index) * line.columnStep) / settings.hop);
  const first = frameAt(0);
  const count = frameAt(line.values.length - 1) - first + 1;
  const frames = await readFrames(processor, 'lead', first, count);
  const expected = Array.from(
    line.values,
    (_, index) => frames[frameAt(index) - first],
  );
  expect(expected.filter((value) => value > 0).length).toBeGreaterThan(
    line.values.length / 2,
  );
  expect(Array.from(line.values)).toEqual(expected);
};

describe('pitch frames', () => {
  const lead = createMelody();

  it(
    'decode the same at every zoom, width and scroll path',
    { timeout: 120_000 },
    async () => {
      const reference = await decodeAlong(
        pitchConfig('lead', 1920, 12),
        lead,
        [5],
      );
      expect(reference.filter((value) => value > 0).length).toBeGreaterThan(
        frameCount / 2,
      );
      const variants = [
        decodeAlong(pitchConfig('lead', 320, 1.5), lead, steps(0.5, 11, 0.25)),
        decodeAlong(pitchConfig('lead', 777, 3.5), lead, steps(11, 0.5, 0.4)),
        decodeAlong(pitchConfig('lead', 1000, 60), lead, [6]),
        decodeAlong(pitchConfig('lead', 256, 4), lead, [7, 1, 9, 3, 11, 5, 2]),
      ];
      for (const variant of variants) {
        expect(Array.from(await variant)).toEqual(Array.from(reference));
      }
    },
  );

  it(
    'never change a recorded frame after its lag',
    { timeout: 120_000 },
    async () => {
      const full = await decodeAlong(pitchConfig('lead', 1920, 12), lead, [5]);
      const config = pitchConfig('recording', 640, 3.5);
      const recording = new Float32Array(lead.length);
      const committed = new Map<number, number>();
      const chunk = Math.round(sampleRate * 0.05);
      const end = Math.round(sampleRate * 9.2);
      await withProcessor({ device, config }, async (processor) => {
        for (let head = chunk; head <= end; head += chunk) {
          recording.set(lead.subarray(head - chunk, head), head - chunk);
          processor.invalidateSamples([
            {
              trackKey: 'recording',
              frameIndex: head - chunk,
              frameCount: chunk,
            },
          ]);
          await processor.render({ recording }, head / recording.length);
          const limit =
            Math.floor((head - settings.support) / settings.hop) -
            settings.lookaheadFrames -
            settings.smoothAheadFrames;
          if (limit < 0) {
            continue;
          }
          const from = Math.max(0, limit - 200);
          const values = await readFrames(
            processor,
            'recording',
            from,
            limit - from + 1,
          );
          for (let index = 0; index < values.length; index += 1) {
            const previous = committed.get(from + index);
            if (previous === undefined) {
              committed.set(from + index, values[index]);
            } else {
              expect(values[index]).toBe(previous);
            }
          }
        }
      });
      for (let index = 0; index < frameCount; index += 1) {
        expect(committed.get(firstFrame + index)).toBe(full[index]);
      }
    },
  );

  it('draws each screen column from the frame at its time', async () => {
    const config = pitchConfig('lead', 700, 2.5);
    await withProcessor({ device, config }, async (processor) => {
      await renderComplete(processor, { lead }, 4.2 / durationSeconds);
      await expectLineFromFrames(processor);
    });
  });
});
