import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type DetailsView = 'text' | 'tracks';

export type ProjectState = {
  detailsView?: DetailsView;
  chordsOpen: boolean;
  audioSettingsOpen: boolean;
  mixdownOpen: boolean;
  mixAnchorEl?: HTMLElement;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
};

const initialState: ProjectState = {
  detailsView: 'text',
  chordsOpen: false,
  audioSettingsOpen: false,
  mixdownOpen: false,
};

export type ProjectActions = {
  setDetailsView: (value: DetailsView | undefined) => void;
  setChordsOpen: (value: boolean) => void;
  setAudioSettingsOpen: (value: boolean) => void;
  setMixdownOpen: (value: boolean) => void;
  setMixAnchorEl: (anchorEl: HTMLElement | undefined) => void;
  setTransposeAnchorEl: (anchorEl: HTMLElement | undefined) => void;
  setTempoAnchorEl: (anchorEl: HTMLElement | undefined) => void;
};

type State = ProjectState & ProjectActions;

export const useProjectStore = create<State>()(
  subscribeWithSelector((set) => ({
    ...initialState,
    setDetailsView: (detailsView) => set({ detailsView }),
    setChordsOpen: (chordsOpen) => set({ chordsOpen }),
    setAudioSettingsOpen: (audioSettingsOpen) => set({ audioSettingsOpen }),
    setMixdownOpen: (mixdownOpen) => set({ mixdownOpen }),
    setMixAnchorEl: (mixAnchorEl) =>
      set({
        mixAnchorEl,
      }),
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
