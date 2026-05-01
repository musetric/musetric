import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type DetailsMode = 'mixer' | 'subtitles';
export type VisualizationMode = 'spectrogram' | 'waveform';

export type ProjectState = {
  visualizationMode: VisualizationMode;
  detailsMode: DetailsMode;
  trackListScrollTop: number;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
};

const initialState: ProjectState = {
  visualizationMode: 'spectrogram',
  detailsMode: 'mixer',
  trackListScrollTop: 0,
};

export type ProjectActions = {
  setVisualizationMode: (value: VisualizationMode) => void;
  setDetailsMode: (value: DetailsMode) => void;
  setTrackListScrollTop: (scrollTop: number) => void;
  setTransposeAnchorEl: (anchorEl: HTMLElement | undefined) => void;
  setTempoAnchorEl: (anchorEl: HTMLElement | undefined) => void;
};

type State = ProjectState & ProjectActions;

export const useProjectStore = create<State>()(
  subscribeWithSelector((set) => {
    return {
      ...initialState,
      setVisualizationMode: (visualizationMode) => set({ visualizationMode }),
      setDetailsMode: (detailsMode) => set({ detailsMode }),
      setTrackListScrollTop: (trackListScrollTop) =>
        set({ trackListScrollTop }),
      setTransposeAnchorEl: (transposeAnchorEl) =>
        set({
          transposeAnchorEl,
        }),
      setTempoAnchorEl: (tempoAnchorEl) =>
        set({
          tempoAnchorEl,
        }),
    };
  }),
);
