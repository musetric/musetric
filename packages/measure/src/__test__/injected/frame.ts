import { isPlaying, type SpectrogramViewMode } from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { epochNow, wait } from './samples.js';

const settleMs = 1000;
const progressMax = 1000;
const rulerMaxHeight = 24;

type Box = { left: number; top: number; width: number; height: number };

const toBox = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const findLayout = () => {
  const canvases = [...document.querySelectorAll('canvas')].map(toBox);
  const spectrogram = canvases
    .toSorted(
      (left, right) => right.width * right.height - left.width * left.height,
    )
    .at(0);
  const ruler = canvases.find(
    (box) =>
      spectrogram !== undefined &&
      box.height <= rulerMaxHeight &&
      box.top >= spectrogram.top + spectrogram.height - 1,
  );
  const rail = document
    .querySelector(`input[type="range"][max="${progressMax}"]`)
    ?.closest('.MuiSlider-root')
    ?.querySelector('.MuiSlider-rail');
  if (!spectrogram || !ruler || !rail) {
    throw new Error(
      'The page shows no spectrogram, time ruler or progress bar',
    );
  }
  return {
    pixelRatio: window.devicePixelRatio,
    spectrogram,
    ruler,
    rail: toBox(rail),
  };
};

export type FrameStartOptions = {
  view: SpectrogramViewMode;
  startSeconds: number;
  playSeconds: number;
};

export type ShowFrameOptions = {
  frameIndex: number;
};

export const createFrameRuns = (hooks: PageHooks) => {
  const { engine } = hooks;
  const { player, store, position } = engine;
  const { sampleRate } = engine.context;
  let held: [epochMs: number, frozen: number][] = [];
  let unsubscribe = (): void => undefined;
  const stop = async () => {
    if (isPlaying(store.get())) {
      await player.stop();
    }
  };
  return {
    start: async (options: FrameStartOptions) => {
      engine.view.setSpectrogramView(options.view);
      await stop();
      player.seek(Math.round(options.startSeconds * sampleRate), 'player');
      await wait(settleMs);
      held = [];
      unsubscribe = store.subscribe(
        (state) => state.frozen,
        (frozen) => {
          held.push([epochNow(), frozen ? 1 : 0]);
        },
      );
      const playedAt = epochNow();
      await player.play();
      await wait(options.playSeconds * 1000);
      return {
        sampleRate,
        frameCount: store.get().frameCount ?? 0,
        playedAt,
        layout: findLayout(),
      };
    },
    stop: async () => {
      unsubscribe();
      await stop();
      return held;
    },
    show: async (options: ShowFrameOptions) => {
      player.seek(options.frameIndex, 'player');
      await wait(settleMs);
      return position.read();
    },
  };
};
