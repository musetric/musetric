import { defaultSampleRate } from '@musetric/utils';
import {
  type SpectrogramConfig,
  type SpectrogramSpectralBand,
  type SpectrogramVisualConfig,
} from './config.cross.js';

export const defaultSpectrogramSpectralBands: SpectrogramSpectralBand[] = [
  {
    label: '4096',
    windowSize: 4096,
    minFrequency: 20,
    fullMinFrequency: 20,
    fullMaxFrequency: 300,
    maxFrequency: 900,
  },
  {
    label: '2048',
    windowSize: 2048,
    minFrequency: 300,
    fullMinFrequency: 900,
    fullMaxFrequency: 2200,
    maxFrequency: 4200,
  },
  {
    label: '1024',
    windowSize: 1024,
    minFrequency: 2200,
    fullMinFrequency: 4200,
    fullMaxFrequency: 20_000,
    maxFrequency: 20_000,
  },
];

export const defaultSpectrogramVisual: SpectrogramVisualConfig = {
  gateFloorDb: -64,
  gateRangeDb: 24,
  frequencyTiltSlope: 0.14,
  frequencyTiltMinGain: 0.72,
  frequencyTiltMaxGain: 1.55,
  displayGamma: 1,
};

export const defaultSpectrogramConfig: Omit<SpectrogramConfig, 'canvas'> = {
  fourierMode: 'fftPackedStockhamR2c',
  windowSize: 1024 * 4,
  sampleRate: defaultSampleRate,
  visibleTime: 3.5,
  playheadRatio: 0.4,
  zeroPaddingFactor: 2,
  spectralBands: defaultSpectrogramSpectralBands,
  windowName: 'hamming',
  minDecibel: -40,
  visual: defaultSpectrogramVisual,
  minFrequency: 120,
  maxFrequency: 4000,
  viewSize: {
    width: 1,
    height: 1,
  },
  colors: {
    background: '#000000',
    foreground: '#888888',
    primary: '#1976d2',
    recordingMatch: '#4caf50',
    recordingClose: '#ff9800',
    recordingMiss: '#f44336',
  },
  lanes: {
    lead: {
      showSpectrogram: true,
      showFundamental: true,
      lineWidthCents: 26,
      truncateAfterPlayhead: false,
      gainDb: 0,
    },
    recording: {
      showSpectrogram: false,
      showFundamental: true,
      lineWidthCents: 35,
      truncateAfterPlayhead: false,
      gainDb: 0,
    },
  },
  comparison: {
    reference: 'lead',
    target: 'recording',
    matchThresholdCents: 15,
    closeThresholdCents: 50,
  },
};
