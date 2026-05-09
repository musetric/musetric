import {
  applyPatchConfig,
  type ApplyPatchConfigOptions,
} from '../../common/patchConfig.es.js';
import type { SpectrogramConfig } from '../config.cross.js';

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
        first.foreground === second.foreground,
    },
  });
