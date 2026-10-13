import { type api } from '@musetric/api';
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

export type VoiceOctave = -1 | 0 | 1;

export type SingerVoice = 'original' | 'shifted';

export type FrequencyRange = {
  minFrequency: number;
  maxFrequency: number;
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
  recordings: api.recording.Item[];
  isSlave: boolean;
  playerCommandPending: boolean;
  playerFrameIndexPending: boolean;
  backendRevision: number;
  frameIndex: number;
  seekEvent: EngineSeekEvent;
  transposeSemitones: number;
  voiceOctave: VoiceOctave;
  singerVoice: SingerVoice;
  tempoRatio: number;
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

export const getActiveRecording = (
  state: Pick<EngineState, 'recordings'>,
): api.recording.Item | undefined =>
  state.recordings.find((recording) => recording.active);

export const getNoteShiftSemitones = (
  state: Pick<EngineState, 'transposeSemitones' | 'voiceOctave'>,
): number => 12 * state.voiceOctave + state.transposeSemitones;

const getNoteShiftScale = (
  state: Pick<EngineState, 'transposeSemitones' | 'voiceOctave'>,
) => 2 ** (getNoteShiftSemitones(state) / 12);

export const getFrequencyRange = (
  state: Pick<
    EngineState,
    'frequencyRanges' | 'spectrogramView' | 'transposeSemitones' | 'voiceOctave'
  >,
): FrequencyRange => {
  const range = state.frequencyRanges[state.spectrogramView];
  const scale = getNoteShiftScale(state);
  return {
    minFrequency: range.minFrequency * scale,
    maxFrequency: range.maxFrequency * scale,
  };
};

export const toStoredFrequencyRange = (
  state: Pick<EngineState, 'transposeSemitones' | 'voiceOctave'>,
  range: FrequencyRange,
): FrequencyRange => {
  const scale = getNoteShiftScale(state);
  return {
    minFrequency: range.minFrequency / scale,
    maxFrequency: range.maxFrequency / scale,
  };
};

export const getTrackProgress = (
  state: Pick<EngineState, 'frameCount' | 'frameIndex'>,
): number => {
  if (!state.frameCount) return 0;
  return state.frameIndex / state.frameCount;
};
