import {
  defaultSpectrogramConfig,
  type SpectrogramColors,
} from '@musetric/spectrogram';
import {
  type EngineSession,
  type EngineTake,
  type PlayerMotion,
  readTransport,
} from '@musetric/transport';
import {
  defaultFrequencyRanges,
  type EngineRangeRepeat,
  type EngineState,
} from './state.js';

export type EngineOwnState = {
  colors: SpectrogramColors;
  session: EngineSession;
  motion: PlayerMotion;
  take: EngineTake;
  correctedOutputLatencyFrameCount?: number;
  sourceGainDb: number;
  leadSpectrogramGainDb: number;
  audibleTrackVolumes: EngineState['trackVolumes'];
  rangeRepeat: EngineRangeRepeat;
  rangeStopFrame?: number;
};

export type EngineStoreState = EngineState & EngineOwnState;

export const initialEngineState: EngineStoreState = {
  statuses: {
    decoder: 'pending',
    realtime: 'pending',
    player: 'pending',
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
  transport: readTransport({
    session: 'idle',
    take: 'none',
    motion: 'stopped',
  }),
  recordings: [],
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
