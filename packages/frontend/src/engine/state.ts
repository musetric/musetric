import { type SpectrogramColors, type StemType } from '@musetric/audio';

export type PortStatus = 'pending' | 'success' | 'error';

export type WaveformStatuses = Record<StemType, PortStatus> & {
  recording: PortStatus;
};

export type EngineStatuses = {
  decoder: PortStatus;
  realtime: PortStatus;
  spectrogram: PortStatus;
  waveform: WaveformStatuses;
};

export type EngineSeekOrigin =
  | 'playbackEnd'
  | 'player'
  | 'playerProgress'
  | 'remote'
  | 'spectrogramVisualization'
  | 'subtitle'
  | 'tracksVisualization';

export type EngineSeekEvent = {
  revision: number;
  frameIndex: number;
  origin: EngineSeekOrigin;
};

export type EngineState = {
  statuses: EngineStatuses;
  frameCount?: number;
  colors: SpectrogramColors;
  duration: number;
  playing: boolean;
  frozen: boolean;
  recording: boolean;
  isSlave: boolean;
  playerCommandPending: boolean;
  playerFrameIndexPending: boolean;
  backendRevision: number;
  frameIndex: number;
  seekEvent: EngineSeekEvent;
  transposeSemitones: number;
  sourceTempoBpm: number;
  tempoBpm: number;
  microphoneDeviceId?: string;
  microphoneLatencyFrameCount: number;
  microphoneLatencyUserSet: boolean;
  recordingGain: number;
  trackVolumes: Record<StemType, number> & {
    recording: number;
  };
};

export const getTrackProgress = (
  state: Pick<EngineState, 'frameCount' | 'frameIndex'>,
): number => {
  if (!state.frameCount) return 0;
  return state.frameIndex / state.frameCount;
};
