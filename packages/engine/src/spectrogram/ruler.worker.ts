import {
  createTimelineDraw,
  type TimelineConfig,
} from '@musetric/audio/timeline';
import {
  type SpectrogramRulerMount,
  type SpectrogramRulerSize,
} from './protocol.cross.js';

export type RulerMoment = Pick<
  TimelineConfig,
  'duration' | 'frameIndex' | 'frameCount' | 'visibleTime' | 'playheadRatio'
>;

export type Ruler = {
  mount: (message: SpectrogramRulerMount) => void;
  resize: (size: SpectrogramRulerSize) => void;
  unmount: () => void;
  draw: (moment: RulerMoment) => void;
};

export const createRuler = (): Ruler => {
  const draw = createTimelineDraw();
  let mounted: SpectrogramRulerMount | undefined = undefined;
  let drawn = '';

  return {
    mount: (message) => {
      mounted = message;
      drawn = '';
    },
    resize: (size) => {
      if (mounted) {
        mounted = { ...mounted, ...size };
        drawn = '';
      }
    },
    unmount: () => {
      mounted = undefined;
      draw.dispose();
    },
    draw: (moment) => {
      const key = Object.values(moment).join(':');
      if (!mounted || key === drawn) {
        return;
      }
      drawn = key;
      draw.run({ ...mounted, ...moment });
    },
  };
};
