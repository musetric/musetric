import { describe, expect, it } from 'vitest';
import { validateCqtConfig } from '../config.es.js';
import { referenceCqtConfig } from './plan.js';

describe('CQT config', () => {
  it('accepts the frozen reference config', () => {
    expect(() => validateCqtConfig(referenceCqtConfig)).not.toThrow();
  });

  it.each([
    { ...referenceCqtConfig, sampleRate: 0 },
    { ...referenceCqtConfig, hopLength: 1.5 },
    { ...referenceCqtConfig, fmin: Number.NaN },
    { ...referenceCqtConfig, nBins: 0 },
    { ...referenceCqtConfig, binsPerOctave: -1 },
  ])('rejects invalid dimensions', (config) => {
    expect(() => validateCqtConfig(config)).toThrow(RangeError);
  });
});
