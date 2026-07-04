import { type FourierMode, type WindowFunctionName } from '@musetric/fft';
import {
  defaultSpectrogramConfig,
  extractSpectrogramConfig,
  type SpectrogramConfig,
  type SpectrogramZeroPaddingFactor,
} from '@musetric/spectrogram';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { engine } from '../../../engine/engine.js';

export type SettingsState = Pick<
  SpectrogramConfig,
  | 'fourierMode'
  | 'windowSize'
  | 'visibleTime'
  | 'playheadRatio'
  | 'zeroPaddingFactor'
  | 'spectralBands'
  | 'windowName'
  | 'minDecibel'
  | 'visual'
  | 'minFrequency'
  | 'maxFrequency'
> & {
  open: boolean;
};

const initialState: SettingsState = {
  fourierMode: defaultSpectrogramConfig.fourierMode,
  windowSize: defaultSpectrogramConfig.windowSize,
  visibleTime: defaultSpectrogramConfig.visibleTime,
  playheadRatio: defaultSpectrogramConfig.playheadRatio,
  zeroPaddingFactor: defaultSpectrogramConfig.zeroPaddingFactor,
  spectralBands: defaultSpectrogramConfig.spectralBands,
  windowName: defaultSpectrogramConfig.windowName,
  minDecibel: defaultSpectrogramConfig.minDecibel,
  visual: defaultSpectrogramConfig.visual,
  minFrequency: defaultSpectrogramConfig.minFrequency,
  maxFrequency: defaultSpectrogramConfig.maxFrequency,
  open: false,
};

export type SettingsActions = {
  setFourierMode: (value: FourierMode) => void;
  setWindowName: (value: WindowFunctionName) => void;
  setWindowSize: (value: number) => void;
  setMinFrequency: (value: number) => void;
  setMaxFrequency: (value: number) => void;
  setFrequencyRange: (minFrequency: number, maxFrequency: number) => void;
  setMinDecibel: (value: number) => void;
  setVisibleTime: (value: number) => void;
  setPlayheadRatio: (value: number) => void;
  setZeroPaddingFactor: (value: SpectrogramZeroPaddingFactor) => void;
  setOpen: (value: boolean) => void;
};

type State = SettingsState & SettingsActions;
export const useSettingsStore = create<State>()(
  subscribeWithSelector((set) => ({
    ...initialState,
    setFourierMode: (fourierMode) => set({ fourierMode }),
    setWindowName: (windowName) => set({ windowName }),
    setWindowSize: (windowSize) => set({ windowSize }),
    setMinFrequency: (minFrequency) => set({ minFrequency }),
    setMaxFrequency: (maxFrequency) => set({ maxFrequency }),
    setFrequencyRange: (minFrequency, maxFrequency) =>
      set({ minFrequency, maxFrequency }),
    setMinDecibel: (minDecibel) => set({ minDecibel }),
    setVisibleTime: (visibleTime) => set({ visibleTime }),
    setPlayheadRatio: (playheadRatio) => set({ playheadRatio }),
    setZeroPaddingFactor: (zeroPaddingFactor) => set({ zeroPaddingFactor }),
    setOpen: (open) => set({ open }),
  })),
);

export const subscribeSettingsStore = () =>
  useSettingsStore.subscribe(
    (state) => state,
    (state) => {
      engine.spectrogram.setConfig(extractSpectrogramConfig(state));
    },
  );
