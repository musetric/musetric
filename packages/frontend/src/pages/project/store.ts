import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { engine } from '../../engine/engine.js';

export type VisualizationMode = 'notes' | 'spectrum' | 'tracks';

export type ProjectState = {
  visualizationMode: VisualizationMode;
  subtitlesOpen: boolean;
  audioSettingsOpen: boolean;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
};

const initialState: ProjectState = {
  visualizationMode: 'spectrum',
  subtitlesOpen: true,
  audioSettingsOpen: false,
};

export type ProjectActions = {
  setVisualizationMode: (value: VisualizationMode) => void;
  setSubtitlesOpen: (value: boolean) => void;
  setAudioSettingsOpen: (value: boolean) => void;
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
    setAudioSettingsOpen: (audioSettingsOpen) => set({ audioSettingsOpen }),
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
