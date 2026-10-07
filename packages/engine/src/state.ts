import { type StemType } from '@musetric/audio';
import { type SpectrogramColors } from '@musetric/spectrogram';

export type PortStatus = 'pending' | 'success' | 'error';

export type CalibrationErrorCode = 'preview' | 'output' | 'calibration';

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
  | 'playhead'
  | 'remote'
  | 'spectrogramVisualization'
  | 'subtitle'
  | 'tracksVisualization';

export type EngineSeekEvent = {
  revision: number;
  frameIndex: number;
  origin: EngineSeekOrigin;
};

export type RecordingLatencySource = 'estimated' | 'manual' | 'calibrated';

export type SpectrogramViewMode = 'notes' | 'spectrum';

export type FrequencyRange = {
  minFrequency: number;
  maxFrequency: number;
};

export type RecordingHistory = {
  canUndo: boolean;
  canRedo: boolean;
};

export type EngineState = {
  statuses: EngineStatuses;
  frameCount?: number;
  colors: SpectrogramColors;
  spectrogramView: SpectrogramViewMode;
  frequencyRanges: Record<SpectrogramViewMode, FrequencyRange>;
  duration: number;
  playing: boolean;
  frozen: boolean;
  recording: boolean;
  recordingHistory: RecordingHistory;
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
  audioOutputDeviceId?: string;
  audioDevices: MediaDeviceInfo[];
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
  latencySource: RecordingLatencySource;
  latencyDevicePairKey?: string;
  calibrating: boolean;
  calibrationError?: CalibrationErrorCode;
  inputLevel: number;
  recordingGain: number;
  sourceGainDb: number;
  leadSpectrogramGainDb: number;
  trackVolumes: Record<StemType, number> & {
    recording: number;
  };
  metronomeEnabled: boolean;
  metronomeVolume: number;
  metronomeBeats: number[];
  metronomeDownbeats: number[];
};

export const getFrequencyRange = (
  state: Pick<EngineState, 'frequencyRanges' | 'spectrogramView'>,
): FrequencyRange => state.frequencyRanges[state.spectrogramView];

export const getTrackProgress = (
  state: Pick<EngineState, 'frameCount' | 'frameIndex'>,
): number => {
  if (!state.frameCount) return 0;
  return state.frameIndex / state.frameCount;
};
