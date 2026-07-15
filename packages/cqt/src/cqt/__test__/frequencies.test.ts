import { describe, expect, it } from 'vitest';
import { getCqtBinFrequency, getCqtFrequencies } from '../frequencies.es.js';
import { referenceCqtConfig } from './plan.js';

describe('CQT frequencies', () => {
  it('places C1 at the configured first bin', () => {
    expect(getCqtBinFrequency(referenceCqtConfig, 0)).toBeCloseTo(
      32.70319566257483,
      12,
    );
  });

  it('doubles after one octave and stays monotonic', () => {
    const frequencies = getCqtFrequencies(referenceCqtConfig);
    expect(frequencies).toHaveLength(144);
    expect(frequencies[24]).toBeCloseTo(frequencies[0] * 2, 12);
    for (let index = 1; index < frequencies.length; index++) {
      expect(frequencies[index]).toBeGreaterThan(frequencies[index - 1]);
    }
  });
});
