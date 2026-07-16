import { type CqtConfig } from './config.es.js';

export const getCqtBinFrequency = (
  config: Pick<CqtConfig, 'fmin' | 'binsPerOctave'>,
  binIndex: number,
): number => config.fmin * 2 ** (binIndex / config.binsPerOctave);

export const getCqtFrequencies = (
  config: Pick<CqtConfig, 'fmin' | 'nBins' | 'binsPerOctave'>,
): Float64Array => {
  const frequencies = new Float64Array(config.nBins);
  for (let binIndex = 0; binIndex < frequencies.length; binIndex++) {
    frequencies[binIndex] = getCqtBinFrequency(config, binIndex);
  }
  return frequencies;
};
