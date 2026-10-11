import { describe, expect, it } from 'vitest';
import {
  brightestRow,
  createTone,
  readCanvas,
  rowAtFrequency,
} from './common.js';
import {
  device,
  singleBandConfig,
  toneFrequency,
  withProcessor,
} from './processor.fixtures.js';

describe('spectrogram processor transpose', () => {
  it('renders a tone moved by the lane key', async () => {
    const base = singleBandConfig();
    const config = singleBandConfig({
      lanes: {
        ...base.lanes,
        lead: { ...base.lanes.lead, transposeSemitones: 12 },
      },
    });
    await withProcessor({ device, config }, async (processor) => {
      const lead = createTone(
        config.sampleRate * 5,
        toneFrequency,
        config.sampleRate,
      );
      const ok = await processor.render({ lead }, 0.5);
      expect(ok).toBe(true);

      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const expectedRow = rowAtFrequency(toneFrequency * 2, config);
      const actualRow = brightestRow(pixels, width, height);
      expect(Math.abs(actualRow - expectedRow)).toBeLessThan(height * 0.05);
    });
  });
});
