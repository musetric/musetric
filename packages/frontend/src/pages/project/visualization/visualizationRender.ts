import { subscribeResizeObserver } from '@musetric/utils/dom';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';

export const alignPixel = (value: number, pixelRatio: number): number =>
  Math.round(value * pixelRatio) / pixelRatio;

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
