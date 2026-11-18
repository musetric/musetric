import { describe, it } from 'vitest';
import { createTone, readCanvas } from './common.js';
import {
  device,
  expectMatchesReference,
  renderFromScratch,
  singleBandConfig,
  toneFrequency,
  withTwoProcessors,
} from './processor.fixtures.js';

describe('spectrogram processor frequency range', () => {
  it('matches a full render after the frequency range moves', async () => {
    const moved = { minFrequency: 240, maxFrequency: 3000 };
    const incrementalConfig = singleBandConfig();
    const fullConfig = singleBandConfig(moved);
    const lead = createTone(
      incrementalConfig.sampleRate * 5,
      toneFrequency,
      incrementalConfig.sampleRate,
    );
    await withTwoProcessors(
      { device, config: incrementalConfig },
      { device, config: fullConfig },
      async (incremental, full) => {
        await incremental.render({ lead }, 0.5);
        incremental.updateConfig(moved);
        await incremental.render({ lead }, 0.5);
        const incrementalPixels = await readCanvas(incrementalConfig.canvas);
        const fullPixels = await renderFromScratch(
          full,
          fullConfig,
          { lead },
          0.5,
        );
        expectMatchesReference(incrementalPixels, fullPixels);
      },
    );
  });
});
