import { type FourierMode, type WindowFunctionName } from '@musetric/fft';
import {
  defaultSpectrogramConfig,
  extractSpectrogramConfig,
  mapVocalMarkKinds,
  type SpectrogramConfig,
  type SpectrogramZeroPaddingFactor,
  type VocalMarkKind,
} from '@musetric/spectrogram';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { engine } from '../../../engine/engine.js';
import { stencilFadeOf, usePracticeStore } from '../vocal/practiceStore.js';

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
  | 'harmonics'
  | 'harmonicComparison'
  | 'stencil'
> & {
  vocalCoach: Record<VocalMarkKind, boolean>;
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
  harmonics: { ...defaultSpectrogramConfig.harmonics, enabled: true },
  harmonicComparison: {
    ...defaultSpectrogramConfig.harmonicComparison,
    enabled: true,
  },
  stencil: { ...defaultSpectrogramConfig.stencil, enabled: true },
  vocalCoach: mapVocalMarkKinds(() => true),
  open: false,
};

export type SettingsActions = {
  setFourierMode: (value: FourierMode) => void;
  setWindowName: (value: WindowFunctionName) => void;
  setWindowSize: (value: number) => void;
  setMinDecibel: (value: number) => void;
  setVisibleTime: (value: number) => void;
  setPlayheadRatio: (value: number) => void;
  setZeroPaddingFactor: (value: SpectrogramZeroPaddingFactor) => void;
  setHarmonicsEnabled: (value: boolean) => void;
  setHarmonicComparisonEnabled: (value: boolean) => void;
  setVocalCoachKind: (kind: VocalMarkKind, enabled: boolean) => void;
  setStencilEnabled: (value: boolean) => void;
  setStencilOpacity: (value: number) => void;
  setStencilOctaveShift: (value: number) => void;
  setOpen: (value: boolean) => void;
};

type State = SettingsState & SettingsActions;
export const useSettingsStore = create<State>()(
  subscribeWithSelector((set) => ({
    ...initialState,
    setFourierMode: (fourierMode) => set({ fourierMode }),
    setWindowName: (windowName) => set({ windowName }),
    setWindowSize: (windowSize) => set({ windowSize }),
    setMinDecibel: (minDecibel) => set({ minDecibel }),
    setVisibleTime: (visibleTime) => set({ visibleTime }),
    setPlayheadRatio: (playheadRatio) => set({ playheadRatio }),
    setZeroPaddingFactor: (zeroPaddingFactor) => set({ zeroPaddingFactor }),
    setHarmonicsEnabled: (enabled) =>
      set((state) => ({ harmonics: { ...state.harmonics, enabled } })),
    setHarmonicComparisonEnabled: (enabled) =>
      set((state) => ({
        harmonicComparison: { ...state.harmonicComparison, enabled },
      })),
    setVocalCoachKind: (kind, enabled) =>
      set((state) => ({
        vocalCoach: { ...state.vocalCoach, [kind]: enabled },
      })),
    setStencilEnabled: (enabled) =>
      set((state) => ({ stencil: { ...state.stencil, enabled } })),
    setStencilOpacity: (opacity) =>
      set((state) => ({ stencil: { ...state.stencil, opacity } })),
    setStencilOctaveShift: (octaveShift) =>
      set((state) => ({ stencil: { ...state.stencil, octaveShift } })),
    setOpen: (open) => set({ open }),
  })),
);

export const spectrogramSettingsConfig = () => {
  const state = useSettingsStore.getState();
  const fade = stencilFadeOf(usePracticeStore.getState());
  return extractSpectrogramConfig({
    ...state,
    stencil: { ...state.stencil, opacity: state.stencil.opacity * fade },
  });
};

export const subscribeSettingsStore = () => {
  const push = () => {
    engine.spectrogram.setConfig(spectrogramSettingsConfig());
  };
  const unsubscribeSettings = useSettingsStore.subscribe(
    (state) => state,
    push,
  );
  const unsubscribePractice = usePracticeStore.subscribe(stencilFadeOf, push);
  return () => {
    unsubscribeSettings();
    unsubscribePractice();
  };
};
