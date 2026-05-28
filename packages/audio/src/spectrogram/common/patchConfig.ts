import {
  applyPatchConfig,
  type ApplyPatchConfigOptions,
} from '../../common/patchConfig.es.js';
import {
  allTrackKeys,
  type SpectrogramConfig,
  type SpectrogramLaneConfig,
} from '../config.cross.js';

const areLanesEqual = (
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
      a.truncateAfterPlayhead === b.truncateAfterPlayhead
    );
  });

export const applySpectrogramPatchConfig = (
  options: ApplyPatchConfigOptions<SpectrogramConfig>,
) =>
  applyPatchConfig({
    base: options.base,
    draft: options.draft,
    patch: options.patch,
    isEqual: options.isEqual ?? {
      viewSize: (first, second) =>
        first.width === second.width && first.height === second.height,
      colors: (first, second) =>
        first.background === second.background &&
        first.foreground === second.foreground &&
        first.primary === second.primary &&
        first.recordingMatch === second.recordingMatch &&
        first.recordingClose === second.recordingClose &&
        first.recordingMiss === second.recordingMiss,
      lanes: areLanesEqual,
      comparison: (first, second) =>
        first.reference === second.reference &&
        first.target === second.target &&
        first.matchThresholdCents === second.matchThresholdCents &&
        first.closeThresholdCents === second.closeThresholdCents,
    },
  });
