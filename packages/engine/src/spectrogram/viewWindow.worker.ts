import { type SpectrogramConfig } from '@musetric/spectrogram';
import { type SpectrogramViewWindow } from './protocol.cross.js';

type SpectrogramView = Pick<SpectrogramConfig, 'visibleTime' | 'playheadRatio'>;

export type ViewWindowState = {
  remember: (config: Partial<SpectrogramConfig>) => void;
  filter: (patch: Partial<SpectrogramConfig>) => Partial<SpectrogramConfig>;
  set: (
    window: SpectrogramViewWindow | undefined,
  ) => Partial<SpectrogramView> | undefined;
  view: (frameIndex: number) => SpectrogramView | undefined;
};

export const createViewWindowState = (): ViewWindowState => {
  let window: SpectrogramViewWindow | undefined = undefined;
  let sampleRate = 0;
  const ownView: Partial<SpectrogramView> = {};

  return {
    remember: (config) => {
      if (config.sampleRate !== undefined) {
        sampleRate = config.sampleRate;
      }
      if (config.visibleTime !== undefined) {
        ownView.visibleTime = config.visibleTime;
      }
      if (config.playheadRatio !== undefined) {
        ownView.playheadRatio = config.playheadRatio;
      }
    },
    filter: (patch) => {
      if (!window) {
        return patch;
      }
      const rest = { ...patch };
      delete rest.visibleTime;
      delete rest.playheadRatio;
      return rest;
    },
    set: (next) => {
      window = next;
      return next ? undefined : { ...ownView };
    },
    view: (frameIndex) =>
      window && sampleRate > 0
        ? {
            visibleTime: window.frameCount / sampleRate,
            playheadRatio: (frameIndex - window.startFrame) / window.frameCount,
          }
        : undefined,
  };
};
