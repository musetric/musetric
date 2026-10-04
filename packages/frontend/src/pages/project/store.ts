import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { engine } from '../../engine/engine.js';

export type VisualizationMode = 'notes' | 'spectrum' | 'tracks';

export type ProjectState = {
  visualizationMode: VisualizationMode;
  subtitlesOpen: boolean;
  chordsOpen: boolean;
  audioSettingsOpen: boolean;
  mixdownOpen: boolean;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
};

const initialState: ProjectState = {
  visualizationMode: 'spectrum',
  subtitlesOpen: true,
  chordsOpen: true,
  audioSettingsOpen: false,
  mixdownOpen: false,
};

export type ProjectActions = {
  setVisualizationMode: (value: VisualizationMode) => void;
  setSubtitlesOpen: (value: boolean) => void;
  setChordsOpen: (value: boolean) => void;
  setAudioSettingsOpen: (value: boolean) => void;
  setMixdownOpen: (value: boolean) => void;
  setTransposeAnchorEl: (anchorEl: HTMLElement | undefined) => void;
  setTempoAnchorEl: (anchorEl: HTMLElement | undefined) => void;
};

type State = ProjectState & ProjectActions;

export const useProjectStore = create<State>()(
  subscribeWithSelector((set) => ({
    ...initialState,
    setVisualizationMode: (visualizationMode) => {
      set({ visualizationMode });
      if (visualizationMode !== 'tracks') {
        engine.store.update((state) => {
          state.spectrogramView = visualizationMode;
        });
      }
    },
    setSubtitlesOpen: (subtitlesOpen) => set({ subtitlesOpen }),
    setChordsOpen: (chordsOpen) => set({ chordsOpen }),
    setAudioSettingsOpen: (audioSettingsOpen) => set({ audioSettingsOpen }),
    setMixdownOpen: (mixdownOpen) => set({ mixdownOpen }),
    setTransposeAnchorEl: (transposeAnchorEl) =>
      set({
        transposeAnchorEl,
      }),
    setTempoAnchorEl: (tempoAnchorEl) =>
      set({
        tempoAnchorEl,
      }),
  })),
);
