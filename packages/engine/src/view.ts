import {
  type SpectrogramColors,
  type SpectrogramExpandedLane,
} from '@musetric/spectrogram';
import { type Store } from './common/store.js';
import {
  type EngineState,
  type EngineViewWindow,
  type FrequencyRange,
  type SpectrogramViewMode,
  toStoredFrequencyRange,
} from './state.js';

export type EngineView = {
  setColors: (colors: SpectrogramColors) => void;
  setSpectrogramView: (spectrogramView: SpectrogramViewMode) => void;
  setExpandedSpectrumLane: (lane: SpectrogramExpandedLane) => void;
  setViewWindow: (viewWindow: EngineViewWindow | undefined) => void;
  setFrequencyRange: (range: FrequencyRange) => void;
  setFrequencyRanges: (
    ranges: Record<SpectrogramViewMode, FrequencyRange>,
  ) => void;
  setLeadSpectrogramGainDb: (leadSpectrogramGainDb: number) => void;
};

export const createEngineView = (store: Store<EngineState>): EngineView => ({
  setColors: (colors) => {
    store.update((state) => {
      state.colors = colors;
    });
  },
  setSpectrogramView: (spectrogramView) => {
    store.update((state) => {
      state.spectrogramView = spectrogramView;
    });
  },
  setExpandedSpectrumLane: (lane) => {
    store.update((state) => {
      state.expandedSpectrumLane = lane;
    });
  },
  setViewWindow: (viewWindow) => {
    store.update((state) => {
      state.viewWindow = viewWindow;
    });
  },
  setFrequencyRange: (range) => {
    store.update((state) => {
      state.frequencyRanges[state.spectrogramView] = toStoredFrequencyRange(
        state,
        range,
      );
    });
  },
  setFrequencyRanges: (ranges) => {
    store.update((state) => {
      state.frequencyRanges = ranges;
    });
  },
  setLeadSpectrogramGainDb: (leadSpectrogramGainDb) => {
    store.update((state) => {
      state.leadSpectrogramGainDb = leadSpectrogramGainDb;
    });
  },
});
