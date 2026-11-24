import { type api } from '@musetric/api';
import { type StemType } from '@musetric/audio';
import { type RecordingLatencyCalibrationClickVerdict } from '@musetric/audio/es';
import {
  defaultSpectrogramConfig,
  type SpectrogramColors,
  type SpectrogramExpandedLane,
} from '@musetric/spectrogram';
import { type PlayerMotion } from './player/protocol.cross.js';

export type PortStatus = 'pending' | 'success' | 'error';

export type CalibrationErrorCode =
  | 'preview'
  | 'output'
  | 'calibration'
  | 'noisy'
  | 'quiet'
  | 'unsteady'
  | 'silent';

export type CalibrationClick =
  RecordingLatencyCalibrationClickVerdict | 'pending';

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

export type EngineSession =
  'idle' | 'starting' | 'playing' | 'taking' | 'stopping';

export type EngineTake = 'none' | 'arming' | 'recording' | 'draining';

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
  expandedSpectrumLane: SpectrogramExpandedLane;
  frequencyRanges: Record<SpectrogramViewMode, FrequencyRange>;
  viewWindow?: EngineViewWindow;
  duration: number;
  session: EngineSession;
  motion: PlayerMotion;
  frozen: boolean;
  take: EngineTake;
  recordings: api.recording.Item[];
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
  calibrationClicks: CalibrationClick[];
  calibrationClickIndex: number;
  calibrationLevel: number;
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
  audibleTrackVolumes: Record<StemType, number> & {
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
  frameIndex: number,
  frameCount: number | undefined,
): number => {
  if (!frameCount) return 0;
  return frameIndex / frameCount;
};

export const clampToRange = (
  frameIndex: number,
  range: EngineRange | undefined,
): number =>
  range
    ? Math.min(range.toFrame - 1, Math.max(range.fromFrame, frameIndex))
    : frameIndex;

const notesMaxFrequency = 1100;

export const defaultFrequencyRanges: Record<
  SpectrogramViewMode,
  FrequencyRange
> = {
  notes: {
    minFrequency: defaultSpectrogramConfig.minFrequency,
    maxFrequency: notesMaxFrequency,
  },
  spectrum: {
    minFrequency: defaultSpectrogramConfig.minFrequency,
    maxFrequency: defaultSpectrogramConfig.maxFrequency,
  },
};

export const initialEngineState: EngineState = {
  statuses: {
    decoder: 'pending',
    realtime: 'pending',
    spectrogram: 'pending',
    waveform: {
      lead: 'pending',
      backing: 'pending',
      instrumental: 'pending',
      recording: 'pending',
    },
  },
  colors: defaultSpectrogramConfig.colors,
  spectrogramView: 'notes',
  expandedSpectrumLane: 'none',
  frequencyRanges: defaultFrequencyRanges,
  duration: 0,
  session: 'idle',
  motion: 'stopped',
  frozen: false,
  take: 'none',
  recordings: [],
  seekEvent: {
    revision: 0,
    frameIndex: 0,
    origin: 'player',
  },
  transposeSemitones: 0,
  voiceOctave: 0,
  singerVoice: 'original',
  tempoRatio: 1,
  audioDevices: [],
  outputLatencyFrameCount: 0,
  outputLatencyFloorFrameCount: 0,
  latencyCorrectionFrameCount: 0,
  inputLatencyFrameCount: 0,
  latencySource: 'estimated',
  calibrating: false,
  calibrationClicks: [],
  calibrationClickIndex: -1,
  calibrationLevel: 0,
  calibrationSkippedPairKeys: [],
  microphoneDenialOpen: false,
  inputLevel: 0,
  recordingGain: 1,
  sourceGainDb: 0,
  leadSpectrogramGainDb: defaultSpectrogramConfig.lanes.lead.gainDb,
  trackVolumes: {
    lead: 1,
    backing: 1,
    instrumental: 1,
    recording: 1,
  },
  audibleTrackVolumes: {
    lead: 1,
    backing: 1,
    instrumental: 1,
    recording: 1,
  },
  metronomeEnabled: false,
  metronomeVolume: 0.3,
  metronomeBeats: [],
  metronomeDownbeats: [],
  rangeRepeat: 'cycle',
  loopTries: [],
};

export const isPlaying = (state: Pick<EngineState, 'session'>): boolean =>
  state.session === 'starting' ||
  state.session === 'playing' ||
  state.session === 'taking';

export const isRecording = (state: Pick<EngineState, 'take'>): boolean =>
  state.take !== 'none';

export const isTransportBusy = (
  state: Pick<EngineState, 'session' | 'take'>,
): boolean =>
  state.session === 'starting' ||
  state.session === 'stopping' ||
  state.take === 'arming' ||
  state.take === 'draining';

export const isBuffering = (state: Pick<EngineState, 'motion'>): boolean =>
  state.motion === 'buffering';
