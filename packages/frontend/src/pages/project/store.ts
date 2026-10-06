import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type DetailsView = 'text' | 'tracks';

export type ProjectState = {
  detailsView?: DetailsView;
  spectrogramOpen: boolean;
  chordsOpen: boolean;
  audioSettingsOpen: boolean;
  mixdownOpen: boolean;
  mixAnchorEl?: HTMLElement;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
};

const initialState: ProjectState = {
  detailsView: 'text',
  spectrogramOpen: true,
  chordsOpen: false,
  audioSettingsOpen: false,
  mixdownOpen: false,
};

export type ProjectActions = {
  setDetailsView: (value: DetailsView | undefined) => void;
  setSpectrogramOpen: (value: boolean) => void;
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
    setSpectrogramOpen: (spectrogramOpen) => set({ spectrogramOpen }),
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
