import { describe, expect, it } from 'vitest';
import { type SpectrogramSamples } from '../processor.js';
import { createTone } from './common.js';
import {
  device,
  singleBandConfig,
  withProcessor,
} from './processor.fixtures.js';

const sampleRate = 48000;
const seconds = 4;
const firstFrame = Math.round((1.5 * sampleRate) / 240);

const comparisonConfig = () => {
  const base = singleBandConfig();
  return singleBandConfig({
    lanes: {
      lead: { ...base.lanes.lead, showFundamental: false },
      recording: { ...base.lanes.recording, showFundamental: true },
    },
  });
};

const voicedLeadFrames = async (
  samples: SpectrogramSamples,
): Promise<number> => {
  const config = comparisonConfig();
  return withProcessor({ device, config }, async (processor) => {
    await processor.render(samples, 0.5);
    while (processor.hasPendingWork()) {
      await processor.render(samples, 0.5);
    }
    const frames = await processor.readFundamentalFrames(
      'lead',
      firstFrame,
      40,
    );
    if (!frames) {
      throw new Error('the fundamental frames were not rendered');
    }
    return Array.from(frames.values).filter((value) => value > 0).length;
  });
};

describe('spectrogram processor comparison reference', () => {
  it('tracks the hidden lead only while there is a recording to compare', async () => {
    const lead = createTone(seconds * sampleRate, 220, sampleRate, 0.5);
    const recording = createTone(seconds * sampleRate, 330, sampleRate, 0.5);
    expect(await voicedLeadFrames({ lead })).toBe(0);
    expect(await voicedLeadFrames({ lead, recording })).toBeGreaterThan(30);
  });
});
