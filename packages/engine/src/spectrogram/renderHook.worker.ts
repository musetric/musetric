import { type SpectrogramProcessor } from '@musetric/spectrogram/gpu';

export type RenderedFrame = {
  processor: SpectrogramProcessor;
  startedAt: number;
  playheadFrame: number;
  writtenEnd: number;
};

export type RenderListener = (frame: RenderedFrame) => Promise<void>;

export type RenderHook = {
  notify: RenderListener;
  setListener: (listener: RenderListener | undefined) => void;
};

export const createRenderHook = (): RenderHook => {
  let listener: RenderListener | undefined = undefined;
  return {
    notify: async (frame) => {
      await listener?.(frame);
    },
    setListener: (next) => {
      listener = next;
    },
  };
};
