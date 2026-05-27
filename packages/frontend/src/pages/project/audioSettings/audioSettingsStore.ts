import { type RecordingLatencyEstimate } from '@musetric/audio/recording';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type AudioSettingsState = {
  audioDevices: MediaDeviceInfo[];
  level: number;
  calibrating: boolean;
  error?: string;
  latencyEstimate?: RecordingLatencyEstimate;
  previewStream?: MediaStream;
};

const initialState: AudioSettingsState = {
  audioDevices: [],
  level: 0,
  calibrating: false,
};

export type AudioSettingsActions = {
  setAudioDevices: (audioDevices: MediaDeviceInfo[]) => void;
  setLevel: (level: number) => void;
  setCalibrating: (calibrating: boolean) => void;
  setError: (error: string | undefined) => void;
  setLatencyEstimate: (
    latencyEstimate: RecordingLatencyEstimate | undefined,
  ) => void;
  setPreviewStream: (previewStream: MediaStream | undefined) => void;
};

type AudioSettingsStore = AudioSettingsState & AudioSettingsActions;

export const useAudioSettingsStore = create<AudioSettingsStore>()(
  subscribeWithSelector((set) => {
    return {
      ...initialState,
      setAudioDevices: (audioDevices) => set({ audioDevices }),
      setLevel: (level) => set({ level }),
      setCalibrating: (calibrating) => set({ calibrating }),
      setError: (error) => set({ error }),
      setLatencyEstimate: (latencyEstimate) => set({ latencyEstimate }),
      setPreviewStream: (previewStream) => set({ previewStream }),
    };
  }),
);
