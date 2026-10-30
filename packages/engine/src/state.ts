import { type api } from '@musetric/api';
import { type StemType } from '@musetric/audio';
import {
  type SpectrogramColors,
  type VocalLessonPhrase,
} from '@musetric/spectrogram';
import { type VocalLessonStatus } from './spectrogram/protocol.cross.js';

export type PortStatus = 'pending' | 'success' | 'error';

export type CalibrationErrorCode =
  'preview' | 'output' | 'calibration' | 'noisy' | 'quiet' | 'silent';

export type MicrophoneDenial = 'app' | 'system' | 'page';

export type EngineOutputVolume = {
  volume: number;
  steps: number;
};

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

export type EngineRange = {
  fromFrame: number;
  toFrame: number;
};

export type EngineRangeRepeat = 'cycle' | 'once';

export type EngineRangePlay = {
  startFrame?: number;
  stopFrame?: number;
};

export type EngineLoopStage = 'range' | 'sing';

export type EngineViewWindow = {
  startFrame: number;
  frameCount: number;
};

export type LoopTry = {
  id: string;
  number: number;
  startFrame: number;
  frameCount: number;
  tempoRatio: number;
};

export type LoopTryPhase = 'armed' | 'writing';

export type FrequencyRange = {
  minFrequency: number;
  maxFrequency: number;
};

export type EngineState = {
  statuses: EngineStatuses;
  frameCount?: number;
  colors: SpectrogramColors;
  spectrogramView: SpectrogramViewMode;
  vocalLessonEnabled: boolean;
  vocalLessonStatus: VocalLessonStatus;
  vocalLessonPhrases: VocalLessonPhrase[];
  frequencyRanges: Record<SpectrogramViewMode, FrequencyRange>;
  viewWindow?: EngineViewWindow;
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
  outputLatencyFrameCount: number;
  outputLatencyFloorFrameCount: number;
  latencyCorrectionFrameCount: number;
  outputCorrectionFrameCount?: number;
  correctedOutputLatencyFrameCount?: number;
  inputLatencyFrameCount: number;
  timedRoundTripFrameCount?: number;
  latencySource: RecordingLatencySource;
  latencyDevicePairKey?: string;
  calibrating: boolean;
  calibrationClickCount: number;
  calibrationError?: CalibrationErrorCode;
  calibrationSkippedPairKeys: string[];
  microphoneDenial?: MicrophoneDenial;
  microphoneDenialOpen: boolean;
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
  range?: EngineRange;
  rangeRepeat: EngineRangeRepeat;
  rangeStopFrame?: number;
  loopStage?: EngineLoopStage;
  loopTries: LoopTry[];
  loopSelectedTryId?: string;
  loopTryPhase?: LoopTryPhase;
};

type LatencyState = Pick<
  EngineState,
  | 'outputLatencyFrameCount'
  | 'outputLatencyFloorFrameCount'
  | 'latencyCorrectionFrameCount'
  | 'outputCorrectionFrameCount'
  | 'inputLatencyFrameCount'
  | 'timedRoundTripFrameCount'
>;

const getEstimatedOutputLatencyFrameCount = (
  state: Pick<
    LatencyState,
    'outputLatencyFrameCount' | 'outputLatencyFloorFrameCount'
  >,
): number =>
  Math.max(state.outputLatencyFrameCount, state.outputLatencyFloorFrameCount);

export const getOutputLatencyFrameCount = (
  state: Pick<
    LatencyState,
    | 'outputLatencyFrameCount'
    | 'outputLatencyFloorFrameCount'
    | 'outputCorrectionFrameCount'
  >,
): number =>
  state.outputCorrectionFrameCount === undefined
    ? getEstimatedOutputLatencyFrameCount(state)
    : Math.max(
        0,
        state.outputLatencyFrameCount + state.outputCorrectionFrameCount,
      );

export const getInputLatencyFrameCount = (state: LatencyState): number =>
  state.timedRoundTripFrameCount === undefined
    ? state.inputLatencyFrameCount
    : state.timedRoundTripFrameCount - state.outputLatencyFrameCount;

export const getInputShareFrameCount = (state: LatencyState): number =>
  Math.max(
    0,
    getInputLatencyFrameCount(state) + state.latencyCorrectionFrameCount,
  );

export const getRecordingLatencyFrameCount = (state: LatencyState): number =>
  getOutputLatencyFrameCount(state) + getInputShareFrameCount(state);

export const getCalibrationNeeded = (
  state: Pick<
    EngineState,
    'latencySource' | 'latencyDevicePairKey' | 'calibrationSkippedPairKeys'
  >,
): boolean =>
  state.latencySource === 'estimated' &&
  (state.latencyDevicePairKey === undefined ||
    !state.calibrationSkippedPairKeys.includes(state.latencyDevicePairKey));

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

export const clampToRange = (
  frameIndex: number,
  range: EngineRange | undefined,
): number =>
  range
    ? Math.min(range.toFrame - 1, Math.max(range.fromFrame, frameIndex))
    : frameIndex;
