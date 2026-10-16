import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { type PickerSide } from './pickerPlacement.js';

export type DetailsView = 'text' | 'tracks';

export type ProjectState = {
  detailsView?: DetailsView;
  spectrogramOpen: boolean;
  chordsOpen: boolean;
  audioSettingsOpen: boolean;
  mixdownOpen: boolean;
  pickerSide: PickerSide;
  mixAnchorEl?: HTMLElement;
  transposeAnchorEl?: HTMLElement;
  tempoAnchorEl?: HTMLElement;
  recordingListAnchorEl?: HTMLElement;
  deletingRecordingId?: number;
  renamingRecordingId?: number;
  creatingRecordingId?: number;
};

const initialState: ProjectState = {
  detailsView: 'text',
  spectrogramOpen: true,
  chordsOpen: false,
  audioSettingsOpen: false,
  mixdownOpen: false,
  pickerSide: 'top',
};

export type ProjectActions = {
  setDetailsView: (value: DetailsView | undefined) => void;
  setSpectrogramOpen: (value: boolean) => void;
  setChordsOpen: (value: boolean) => void;
  setAudioSettingsOpen: (value: boolean) => void;
  setMixdownOpen: (value: boolean) => void;
  setMixAnchorEl: (
    anchorEl: HTMLElement | undefined,
    side?: PickerSide,
  ) => void;
  setTransposeAnchorEl: (
    anchorEl: HTMLElement | undefined,
    side?: PickerSide,
  ) => void;
  setTempoAnchorEl: (
    anchorEl: HTMLElement | undefined,
    side?: PickerSide,
  ) => void;
  setRecordingListAnchorEl: (anchorEl: HTMLElement | undefined) => void;
  setDeletingRecordingId: (recordingId: number | undefined) => void;
  setRenamingRecordingId: (recordingId: number | undefined) => void;
  setCreatingRecordingId: (recordingId: number | undefined) => void;
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
    setMixAnchorEl: (mixAnchorEl, side = 'top') =>
      set(mixAnchorEl ? { mixAnchorEl, pickerSide: side } : { mixAnchorEl }),
    setTransposeAnchorEl: (transposeAnchorEl, side = 'top') =>
      set(
        transposeAnchorEl
          ? { transposeAnchorEl, pickerSide: side }
          : { transposeAnchorEl },
      ),
    setTempoAnchorEl: (tempoAnchorEl, side = 'top') =>
      set(
        tempoAnchorEl ? { tempoAnchorEl, pickerSide: side } : { tempoAnchorEl },
      ),
    setRecordingListAnchorEl: (recordingListAnchorEl) =>
      set({
        recordingListAnchorEl,
      }),
    setDeletingRecordingId: (deletingRecordingId) =>
      set({
        deletingRecordingId,
      }),
    setRenamingRecordingId: (renamingRecordingId) =>
      set({
        renamingRecordingId,
        creatingRecordingId: undefined,
      }),
    setCreatingRecordingId: (creatingRecordingId) =>
      set({
        renamingRecordingId: creatingRecordingId,
        creatingRecordingId,
      }),
  })),
);
