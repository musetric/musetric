import {
  extractSpectrogramConfig,
  type FourierMode,
  type SpectrogramConfig,
  type SpectrogramWindowName,
  type SpectrogramZeroPaddingFactor,
} from '@musetric/audio';
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
  | 'windowName'
  | 'minDecibel'
  | 'minFrequency'
  | 'maxFrequency'
> & {
  open: boolean;
};

const initialState: SettingsState = {
  fourierMode: 'fftPackedTiledR2c',
  windowSize: 1024 * 4,
  visibleTime: 5,
  playheadRatio: 0.4,
  zeroPaddingFactor: 2,
  windowName: 'hamming',
  minDecibel: -40,
  minFrequency: 120,
  maxFrequency: 4000,
  open: false,
};

export type SettingsActions = {
  setFourierMode: (value: FourierMode) => void;
  setWindowName: (value: SpectrogramWindowName) => void;
  setWindowSize: (value: number) => void;
  setMinFrequency: (value: number) => void;
  setMaxFrequency: (value: number) => void;
  setMinDecibel: (value: number) => void;
  setVisibleTime: (value: number) => void;
  setPlayheadRatio: (value: number) => void;
  setZeroPaddingFactor: (value: SpectrogramZeroPaddingFactor) => void;
  setOpen: (value: boolean) => void;
};

type State = SettingsState & SettingsActions;
export const useSettingsStore = create<State>()(
  subscribeWithSelector((set) => {
    return {
      ...initialState,
      setFourierMode: (fourierMode) => set({ fourierMode }),
      setWindowName: (windowName) => set({ windowName }),
      setWindowSize: (windowSize) => set({ windowSize }),
      setMinFrequency: (minFrequency) => set({ minFrequency }),
      setMaxFrequency: (maxFrequency) => set({ maxFrequency }),
      setMinDecibel: (minDecibel) => set({ minDecibel }),
      setVisibleTime: (visibleTime) => set({ visibleTime }),
      setPlayheadRatio: (playheadRatio) => set({ playheadRatio }),
      setZeroPaddingFactor: (zeroPaddingFactor) => set({ zeroPaddingFactor }),
      setOpen: (open) => set({ open }),
    };
  }),
);

export const subscribeSettingsStore = () =>
  useSettingsStore.subscribe(
    (state) => state,
    (state) => {
      engine.spectrogram.setConfig(extractSpectrogramConfig(state));
    },
  );
