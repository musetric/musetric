import {
  type SpectrogramProcessor,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';

export type RenderedFrame = {
  processor: SpectrogramProcessor;
  device: GPUDevice;
  metrics: SpectrogramProcessorMetrics | undefined;
  startedAt: number;
  playing: boolean;
  playheadFrame: number;
  writtenEnd: number | undefined;
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
