import { allTrackKeys } from '../common/trackKeys.es.js';
import {
  type SpectrogramConfig,
  type SpectrogramHarmonicComparisonConfig,
  type SpectrogramHarmonicsConfig,
  type SpectrogramLaneConfig,
  type SpectrogramSpectralBand,
  type SpectrogramStencilConfig,
  type SpectrogramVisualConfig,
} from '../config.cross.js';

const isSpectrogramViewSizeEqual = (
  first: SpectrogramConfig['viewSize'],
  second: SpectrogramConfig['viewSize'],
) => first.width === second.width && first.height === second.height;

export const isSpectrogramColorsEqual = (
  first: SpectrogramConfig['colors'],
  second: SpectrogramConfig['colors'],
) =>
  first.background === second.background &&
  first.foreground === second.foreground &&
  first.primary === second.primary &&
  first.recordingMatch === second.recordingMatch &&
  first.recordingClose === second.recordingClose &&
  first.recordingMiss === second.recordingMiss &&
  first.recordingTimingMiss === second.recordingTimingMiss &&
  first.harmonic === second.harmonic &&
  first.harmonicQuieter === second.harmonicQuieter &&
  first.harmonicLouder === second.harmonicLouder &&
  first.stencil === second.stencil;

const isSpectrogramLanesEqual = (
  first: Record<string, SpectrogramLaneConfig>,
  second: Record<string, SpectrogramLaneConfig>,
) =>
  allTrackKeys.every((key) => {
    const a = first[key];
    const b = second[key];
    return (
      a.showSpectrogram === b.showSpectrogram &&
      a.showFundamental === b.showFundamental &&
      a.showNotes === b.showNotes &&
      a.lineWidthCents === b.lineWidthCents &&
      a.truncateAfterPlayhead === b.truncateAfterPlayhead &&
      a.gainDb === b.gainDb &&
      a.transposeSemitones === b.transposeSemitones
    );
  });

export const isSpectrogramSpectralBandsEqual = (
  first: SpectrogramSpectralBand[],
  second: SpectrogramSpectralBand[],
) =>
  first.length === second.length &&
  first.every((band, index) => {
    const next = second[index];
    return (
      band.label === next.label &&
      band.windowSize === next.windowSize &&
      band.minFrequency === next.minFrequency &&
      band.fullMinFrequency === next.fullMinFrequency &&
      band.fullMaxFrequency === next.fullMaxFrequency &&
      band.maxFrequency === next.maxFrequency
    );
  });

const isSpectrogramVisualEqual = (
  first: SpectrogramVisualConfig,
  second: SpectrogramVisualConfig,
) =>
  first.gateFloorDb === second.gateFloorDb &&
  first.gateRangeDb === second.gateRangeDb &&
  first.frequencyTiltSlope === second.frequencyTiltSlope &&
  first.frequencyTiltMinGain === second.frequencyTiltMinGain &&
  first.frequencyTiltMaxGain === second.frequencyTiltMaxGain &&
  first.displayGamma === second.displayGamma;

const isSpectrogramComparisonEqual = (
  first: SpectrogramConfig['comparison'],
  second: SpectrogramConfig['comparison'],
) =>
  first.reference === second.reference &&
  first.target === second.target &&
  first.matchThresholdCents === second.matchThresholdCents &&
  first.closeThresholdCents === second.closeThresholdCents &&
  first.missThresholdCents === second.missThresholdCents &&
  first.colorWindowLeftSeconds === second.colorWindowLeftSeconds &&
  first.colorWindowRightSeconds === second.colorWindowRightSeconds &&
  first.colorFalloffSigmaSeconds === second.colorFalloffSigmaSeconds;

export const isSpectrogramHarmonicsEqual = (
  first: SpectrogramHarmonicsConfig,
  second: SpectrogramHarmonicsConfig,
) =>
  first.enabled === second.enabled &&
  first.dominantMaxFrequency === second.dominantMaxFrequency &&
  first.dominantSearchCents === second.dominantSearchCents &&
  first.dominantMarginDb === second.dominantMarginDb &&
  first.ridgeHalfWidthCents === second.ridgeHalfWidthCents &&
  first.smoothingColumns === second.smoothingColumns &&
  first.ringMinFrequency === second.ringMinFrequency &&
  first.ringMaxFrequency === second.ringMaxFrequency &&
  first.ringAmount === second.ringAmount;

export const isSpectrogramHarmonicComparisonEqual = (
  first: SpectrogramHarmonicComparisonConfig,
  second: SpectrogramHarmonicComparisonConfig,
) =>
  first.enabled === second.enabled &&
  first.pitchToleranceCents === second.pitchToleranceCents &&
  first.neutralDb === second.neutralDb &&
  first.fullDb === second.fullDb &&
  first.floorDb === second.floorDb &&
  first.maxHarmonics === second.maxHarmonics &&
  first.missingAmount === second.missingAmount;

export const isSpectrogramStencilEqual = (
  first: SpectrogramStencilConfig,
  second: SpectrogramStencilConfig,
) =>
  first.enabled === second.enabled &&
  first.opacity === second.opacity &&
  first.harmonicCount === second.harmonicCount &&
  first.lineWidthPixels === second.lineWidthPixels &&
  first.overtoneFade === second.overtoneFade &&
  first.octaveShift === second.octaveShift;

export const spectrogramConfigFieldEqual = {
  viewSize: isSpectrogramViewSizeEqual,
  colors: isSpectrogramColorsEqual,
  visual: isSpectrogramVisualEqual,
  lanes: isSpectrogramLanesEqual,
  spectralBands: isSpectrogramSpectralBandsEqual,
  comparison: isSpectrogramComparisonEqual,
  harmonics: isSpectrogramHarmonicsEqual,
  harmonicComparison: isSpectrogramHarmonicComparisonEqual,
  stencil: isSpectrogramStencilEqual,
};
