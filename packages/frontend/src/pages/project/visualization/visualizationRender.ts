import { subscribeResizeObserver } from '@musetric/utils/dom';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';

export const alignPixel = (value: number, pixelRatio: number): number =>
  Math.round(value * pixelRatio) / pixelRatio;

type EngineKey = keyof ReturnType<typeof engine.store.get>;
type ProjectKey = keyof ReturnType<typeof useProjectStore.getState>;
type SettingsKey = keyof ReturnType<typeof useSettingsStore.getState>;

export type VisualizationRenderOptions = {
  resizeTarget: Element;
  onResize: () => void;
  render: () => void;
  engineKeys: readonly EngineKey[];
  projectKeys: readonly ProjectKey[];
  settingsKeys: readonly SettingsKey[];
};

export const subscribeVisualizationRender = (
  options: VisualizationRenderOptions,
): (() => void) => {
  const {
    resizeTarget,
    onResize,
    render,
    engineKeys,
    projectKeys,
    settingsKeys,
  } = options;

  const unsubscribes = [
    subscribeResizeObserver(resizeTarget, onResize),
    ...engineKeys.map((key) =>
      engine.store.subscribe((state) => state[key], render),
    ),
    ...projectKeys.map((key) =>
      useProjectStore.subscribe((state) => state[key], render),
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
