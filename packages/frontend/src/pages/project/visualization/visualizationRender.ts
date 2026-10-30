import { getTrackProgress } from '@musetric/engine';
import { subscribeResizeObserver } from '@musetric/utils/dom';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { getVisualizationView } from './visualizationView.js';

export const alignPixel = (value: number, pixelRatio: number): number =>
  Math.round(value * pixelRatio) / pixelRatio;

export type TimeStripView = {
  width: number;
  stripWidth: number;
};

export type TimeStripPlacement = {
  pixelsPerSecond: number;
  start: number;
  stripX: number;
};

export const placeTimeStrip = (
  strip: HTMLElement,
  view: TimeStripView,
): TimeStripPlacement => {
  const state = engine.store.get();
  const { visibleTime, playheadRatio } = getVisualizationView();
  const pixelsPerSecond = view.width / visibleTime;
  const stripWidth = state.duration * pixelsPerSecond;
  if (stripWidth !== view.stripWidth) {
    view.stripWidth = stripWidth;
    strip.style.width = `${stripWidth}px`;
  }
  const time = state.duration * getTrackProgress(state);
  const start = time - visibleTime * playheadRatio;
  const stripX = alignPixel(-start * pixelsPerSecond, window.devicePixelRatio);
  strip.style.transform = `translateX(${stripX}px)`;
  return { pixelsPerSecond, start, stripX };
};

type EngineKey = keyof ReturnType<typeof engine.store.get>;
type SettingsKey = keyof ReturnType<typeof useSettingsStore.getState>;

export type VisualizationRenderOptions = {
  resizeTarget: Element;
  onResize: () => void;
  render: () => void;
  engineKeys: readonly EngineKey[];
  settingsKeys: readonly SettingsKey[];
};

export const subscribeVisualizationRender = (
  options: VisualizationRenderOptions,
): (() => void) => {
  const { resizeTarget, onResize, render, engineKeys, settingsKeys } = options;

  const unsubscribes = [
    subscribeResizeObserver(resizeTarget, onResize),
    ...engineKeys.map((key) =>
      engine.store.subscribe((state) => state[key], render),
    ),
    ...settingsKeys.map((key) =>
      useSettingsStore.subscribe((state) => state[key], render),
    ),
  ];

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
};
