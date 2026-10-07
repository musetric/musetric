import { describe, expect, it } from 'vitest';
import {
  createMappedSource,
  type SpectrogramSourcePiece,
} from '../common/source.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { type SpectrogramProcessor } from '../processor.js';
import {
  brightestRow,
  createSilence,
  createTone,
  readCanvas,
  rowAtFrequency,
} from './common.js';
import {
  device,
  singleBandConfig,
  withProcessor,
} from './processor.fixtures.js';

const pitch = 440;
const overtone = 3000;
const sampleRate = 48000;

const isVoiced = (value: number): boolean => value > 0;

const centsFromPitch = (value: number): number =>
  Math.abs(1200 * Math.log2(value / pitch));

type TakeSpec = {
  startSeconds: number;
  rawSeconds: number;
  tempo: number;
  raw: Float32Array;
};

const take = (spec: TakeSpec): SpectrogramSourcePiece => {
  const songStartFrame = spec.startSeconds * sampleRate;
  return {
    songStartFrame,
    songEndFrame: songStartFrame + spec.raw.length * spec.tempo,
    rawStartFrame: 0,
    tempo: spec.tempo,
    getSamples: () => spec.raw,
  };
};

const tone = (seconds: number): Float32Array =>
  createTone(seconds * sampleRate, pitch, sampleRate);

const vibratoPitch = (rawSecond: number): number =>
  pitch * 2 ** ((30 / 1200) * Math.sin(2 * Math.PI * 5.5 * rawSecond));

const vibratoVoice = (seconds: number): Float32Array => {
  const voice = new Float32Array(seconds * sampleRate);
  let phase = 0;
  for (let index = 0; index < voice.length; index += 1) {
    phase += (2 * Math.PI * vibratoPitch(index / sampleRate)) / sampleRate;
    let value = 0;
    for (let harmonic = 1; harmonic <= 15; harmonic += 1) {
      value += Math.sin(harmonic * phase) / harmonic;
    }
    voice[index] = 0.2 * value;
  }
  return voice;
};

type VibratoTake = {
  startSeconds: number;
  tempo: number;
  firstFrame: number;
};

const vibratoErrors = (
  values: Float32Array,
  vibratoTake: VibratoTake,
): number[] => {
  const hop = 240;
  const errors = Array.from(values, (value, index) => {
    const songSecond = ((vibratoTake.firstFrame + index) * hop) / sampleRate;
    const rawSecond =
      (songSecond - vibratoTake.startSeconds) / vibratoTake.tempo;
    return isVoiced(value)
      ? Math.abs(1200 * Math.log2(value / vibratoPitch(rawSecond)))
      : Number.POSITIVE_INFINITY;
  });
  return errors.toSorted((left, right) => left - right);
};

const chord = (seconds: number): Float32Array => {
  const low = tone(seconds);
  const high = createTone(seconds * sampleRate, overtone, sampleRate);
  return low.map((value, index) => (value + high[index]) / 2);
};

type Song = {
  seconds: number;
  recording: ReturnType<typeof createMappedSource> | Float32Array;
};

const slowSong: Song = {
  seconds: 5,
  recording: createMappedSource(
    [take({ startSeconds: 2, rawSeconds: 2, tempo: 0.5, raw: tone(2) })],
    5 * sampleRate,
  ),
};

const plainSong = (): Song => {
  const recording = createSilence(5 * sampleRate);
  recording.set(tone(1), 2 * sampleRate);
  return { seconds: 5, recording };
};

const farSong: Song = {
  seconds: 14,
  recording: createMappedSource(
    [
      take({ startSeconds: 1, rawSeconds: 4, tempo: 0.5, raw: tone(4) }),
      take({ startSeconds: 10, rawSeconds: 2, tempo: 0.5, raw: chord(2) }),
    ],
    14 * sampleRate,
  ),
};

const recordingOnlyConfig = (
  fundamental: boolean,
  overrides: Partial<SpectrogramConfig> = {},
): SpectrogramConfig => {
  const base = singleBandConfig();
  return singleBandConfig({
    lanes: {
      lead: { ...base.lanes.lead, showSpectrogram: false },
      recording: {
        ...base.lanes.recording,
        showSpectrogram: true,
        showFundamental: fundamental,
      },
    },
    ...overrides,
  });
};

const renderUntilComplete = async (
  processor: SpectrogramProcessor,
  song: Song,
  progress: number,
): Promise<void> => {
  const lead = createSilence(song.seconds * sampleRate);
  const samples = { lead, recording: song.recording };
  await processor.render(samples, progress);
  while (processor.hasPendingWork()) {
    await processor.render(samples, progress);
  }
};

type ViewAt = {
  config: SpectrogramConfig;
  playheadSeconds: number;
};

const columnAt = (view: ViewAt, seconds: number): number => {
  const { visibleTime, playheadRatio, viewSize, windowSize } = view.config;
  const step = (visibleTime * sampleRate) / (viewSize.width - 1);
  const anchor =
    view.playheadSeconds * sampleRate -
    visibleTime * playheadRatio * sampleRate -
    windowSize / 2;
  return Math.round((seconds * sampleRate) / step - Math.round(anchor / step));
};

const peakAt = (
  pixels: Uint8ClampedArray,
  config: SpectrogramConfig,
  column: number,
  rows: readonly number[] = [],
): number => {
  const { width, height } = config.viewSize;
  const scanned = rows.length > 0 ? rows : [...Array(height).keys()];
  return Math.max(
    ...scanned.map((row) => pixels[(Math.round(row) * width + column) * 4]),
  );
};

const rowsAround = (frequency: number, config: SpectrogramConfig) => {
  const center = rowAtFrequency(frequency, config);
  return [-3, -2, -1, 0, 1, 2, 3].map((offset) => center + offset);
};

describe('spectrogram processor with a slow take', () => {
  it('draws the take at its sung pitch over its span of the song', async () => {
    const config = recordingOnlyConfig(false);
    const progress = 0.5;
    const { width, height } = config.viewSize;
    const plainRow = await withProcessor(
      { device, config },
      async (processor) => {
        await renderUntilComplete(processor, plainSong(), progress);
        return brightestRow(await readCanvas(config.canvas), width, height);
      },
    );
    await withProcessor({ device, config }, async (processor) => {
      await renderUntilComplete(processor, slowSong, progress);
      const pixels = await readCanvas(config.canvas);
      const slowRow = brightestRow(pixels, width, height);
      expect(Math.abs(slowRow - plainRow)).toBeLessThanOrEqual(1);
      expect(Math.abs(slowRow - rowAtFrequency(pitch, config))).toBeLessThan(
        Math.abs(slowRow - rowAtFrequency(pitch * 2, config)),
      );
    });
  });

  it('keeps every band in step far into the song', async () => {
    const config = recordingOnlyConfig(false, {
      zeroPaddingFactor: defaultSpectrogramConfig.zeroPaddingFactor,
      windowSize: defaultSpectrogramConfig.windowSize,
      spectralBands: defaultSpectrogramConfig.spectralBands,
    });
    const center = 10.5;
    await withProcessor({ device, config }, async (processor) => {
      await renderUntilComplete(processor, farSong, center / farSong.seconds);
      const pixels = await readCanvas(config.canvas);
      const view = { config, playheadSeconds: center };
      const inside = columnAt(view, center);
      const lowRows = rowsAround(pitch, config);
      const highRows = rowsAround(overtone, config);
      expect(peakAt(pixels, config, inside, lowRows)).toBeGreaterThan(40);
      expect(peakAt(pixels, config, inside, highRows)).toBeGreaterThan(40);
      expect(peakAt(pixels, config, columnAt(view, 9.6))).toBeLessThan(16);
      expect(peakAt(pixels, config, columnAt(view, 11.4))).toBeLessThan(16);
    });
  });

  it('tracks the sung pitch of the take', async () => {
    const config = recordingOnlyConfig(true);
    await withProcessor({ device, config }, async (processor) => {
      await renderUntilComplete(processor, slowSong, 0.5);
      const firstFrame = Math.round((2.3 * sampleRate) / 240);
      const frames = await processor.readFundamentalFrames(
        'recording',
        firstFrame,
        40,
      );
      if (!frames) {
        throw new Error('the fundamental frames were not rendered');
      }
      const voiced = Array.from(frames.values).filter(isVoiced);
      expect(voiced.length).toBeGreaterThan(30);
      const worst = Math.max(...voiced.map(centsFromPitch));
      expect(worst).toBeLessThan(35);
    });
  });

  it.each([0.5, 0.8, 1.5])(
    'tracks the vibrato of a take sung at tempo %f',
    async (tempo) => {
      const config = recordingOnlyConfig(true);
      const startSeconds = 2;
      const raw = vibratoVoice(2);
      const song: Song = {
        seconds: 6,
        recording: createMappedSource(
          [take({ startSeconds, rawSeconds: 2, tempo, raw })],
          6 * sampleRate,
        ),
      };
      const centerSeconds = startSeconds + tempo;
      await withProcessor({ device, config }, async (processor) => {
        await renderUntilComplete(processor, song, centerSeconds / 6);
        const hop = 240;
        const firstFrame = Math.ceil(
          ((startSeconds + 0.2 * tempo) * sampleRate) / hop,
        );
        const lastFrame = Math.floor(
          ((startSeconds + 1.8 * tempo) * sampleRate) / hop,
        );
        const frames = await processor.readFundamentalFrames(
          'recording',
          firstFrame,
          lastFrame - firstFrame + 1,
        );
        if (!frames) {
          throw new Error('the fundamental frames were not rendered');
        }
        const sorted = vibratoErrors(frames.values, {
          startSeconds,
          tempo,
          firstFrame,
        });
        expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(10);
        expect(sorted[Math.floor(sorted.length * 0.9)]).toBeLessThan(15);
      });
    },
  );
});
