import {
  allTrackKeys,
  type SpectrogramConfig,
  type SpectrogramLaneConfig,
  type SpectrogramSpectralBand,
  type SpectrogramVisualConfig,
} from '../config.cross.js';

const isSpectrogramViewSizeEqual = (
  first: SpectrogramConfig['viewSize'],
  second: SpectrogramConfig['viewSize'],
) => first.width === second.width && first.height === second.height;

const isSpectrogramColorsEqual = (
  first: SpectrogramConfig['colors'],
  second: SpectrogramConfig['colors'],
) =>
  first.background === second.background &&
  first.foreground === second.foreground &&
  first.primary === second.primary &&
  first.recordingMatch === second.recordingMatch &&
  first.recordingClose === second.recordingClose &&
  first.recordingMiss === second.recordingMiss;

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
      a.lineWidthCents === b.lineWidthCents &&
      a.truncateAfterPlayhead === b.truncateAfterPlayhead &&
      a.gainDb === b.gainDb
    );
  });

const isSpectrogramSpectralBandsEqual = (
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
  first.closeThresholdCents === second.closeThresholdCents;

export const spectrogramConfigFieldEqual = {
  viewSize: isSpectrogramViewSizeEqual,
  colors: isSpectrogramColorsEqual,
  visual: isSpectrogramVisualEqual,
  lanes: isSpectrogramLanesEqual,
  spectralBands: isSpectrogramSpectralBandsEqual,
  comparison: isSpectrogramComparisonEqual,
};
