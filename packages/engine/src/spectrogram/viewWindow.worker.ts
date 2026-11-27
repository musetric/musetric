import { type SpectrogramConfig } from '@musetric/spectrogram';
import { type SpectrogramViewWindow } from './protocol.cross.js';

const spanMarginSeconds = 2;

type SpectrogramView = Pick<SpectrogramConfig, 'visibleTime' | 'playheadRatio'>;

export type ViewSpan = {
  from: number;
  to: number;
};

export type ViewWindowState = {
  remember: (config: Partial<SpectrogramConfig>) => void;
  filter: (patch: Partial<SpectrogramConfig>) => Partial<SpectrogramConfig>;
  set: (
    window: SpectrogramViewWindow | undefined,
  ) => Partial<SpectrogramView> | undefined;
  view: (frameIndex: number) => SpectrogramView | undefined;
  span: (frameIndex: number) => ViewSpan | undefined;
};

export const createViewWindowState = (): ViewWindowState => {
  let window: SpectrogramViewWindow | undefined = undefined;
  let sampleRate = 0;
  const ownView: Partial<SpectrogramView> = {};

  const view = (frameIndex: number): SpectrogramView | undefined =>
    window && sampleRate > 0
      ? {
          visibleTime: window.frameCount / sampleRate,
          playheadRatio: (frameIndex - window.startFrame) / window.frameCount,
        }
      : undefined;

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
    view,
    span: (frameIndex) => {
      const { visibleTime, playheadRatio } = view(frameIndex) ?? ownView;
      if (
        visibleTime === undefined ||
        playheadRatio === undefined ||
        sampleRate <= 0
      ) {
        return undefined;
      }
      const visible = visibleTime * sampleRate;
      const margin = spanMarginSeconds * sampleRate;
      const from = frameIndex - visible * playheadRatio - margin;
      return { from, to: from + visible + 2 * margin };
    },
  };
};
