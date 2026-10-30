import { defaultSpectrogramConfig } from '@musetric/spectrogram';
import { defaultSampleRate } from '@musetric/utils';
import {
  createEngineAudioOutput,
  type EngineAudioOutput,
} from './audioOutput/index.js';
import { createEngineOutputClock } from './audioOutput/outputClock.js';
import {
  createEngineMicrophoneAccess,
  type EngineMicrophoneAccess,
} from './audioSession/access.js';
import { createEngineAudioSession } from './audioSession/index.js';
import {
  createEngineCalibration,
  type EngineCalibration,
} from './calibration/index.js';
import { createStore, type Store } from './common/store.js';
import { createEngineDecoder, type EngineDecoder } from './decoder/index.js';
import { createCapturedTap } from './measure/capturedTap.js';
import { createEnginePlayer, type EnginePlayer } from './player/index.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram/index.js';
import {
  type EngineState,
  type FrequencyRange,
  getActiveRecording,
  type SpectrogramViewMode,
} from './state.js';
import { createEngineWaveform, type EngineWaveform } from './waveform/index.js';

const notesMaxFrequency = 1100;
const androidOutputBufferSeconds = 0.02;
const measure = import.meta.env.frontendMeasure === 'true';

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

const initialState: EngineState = {
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
  selectedHarmonics: [],
  vocalCoachEnabled: false,
  vocalCoachStatus: 'idle',
  vocalMarks: [],
  frequencyRanges: defaultFrequencyRanges,
  duration: 0,
  playing: false,
  frozen: false,
  recording: false,
  recordings: [],
  isSlave: false,
  playerCommandPending: false,
  playerFrameIndexPending: false,
  backendRevision: 0,
  frameIndex: 0,
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
  calibrationClickCount: 0,
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
  metronomeEnabled: false,
  metronomeVolume: 0.3,
  metronomeBeats: [],
  metronomeDownbeats: [],
  rangeRepeat: 'cycle',
  loopTries: [],
};

export type Engine = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  store: Store<EngineState>;
  calibration: EngineCalibration;
  microphoneAccess: EngineMicrophoneAccess;
  decoder: EngineDecoder;
  spectrogram: EngineSpectrogram;
  waveform: EngineWaveform;
  player: EnginePlayer;
  boot: () => Promise<void>;
};

export const createEngine = (): Engine => {
  const context = new AudioContext({
    sampleRate: defaultSampleRate,
    latencyHint: navigator.userAgent.includes('Android')
      ? androidOutputBufferSeconds
      : 'interactive',
  });
  const audioOutput = createEngineAudioOutput(context);
  const outputClock = createEngineOutputClock(context);
  const store = createStore(initialState);
  const spectrogramChannel = new MessageChannel();
  const spectrogramPlayheadChannel = new MessageChannel();
  const fundamentalFramesChannel = new MessageChannel();
  const spectrogram = createEngineSpectrogram({
    store,
    sampleRate: context.sampleRate,
    decoderPort: spectrogramChannel.port2,
    playheadPort: spectrogramPlayheadChannel.port2,
    fundamentalPort: fundamentalFramesChannel.port1,
  });
  const capturedTap = measure ? createCapturedTap() : undefined;
  const audioSession = createEngineAudioSession(
    context,
    outputClock,
    (chunk) => {
      spectrogram.previewLiveTake(chunk);
      capturedTap?.push(chunk);
    },
  );
  outputClock.subscribe((reading) => {
    const frameCount = Math.round(reading.renderAhead * context.sampleRate);
    if (frameCount !== store.get().outputLatencyFrameCount) {
      store.update((state) => {
        state.outputLatencyFrameCount = frameCount;
      });
    }
  });
  const playerChannel = new MessageChannel();
  const playerPlayheadChannel = new MessageChannel();
  const decoderPlayheadChannel = new MessageChannel();

  const ref: Engine = {
    context,
    audioOutput,
    store,
    microphoneAccess: createEngineMicrophoneAccess({ store, audioSession }),
    calibration: createEngineCalibration({
      context,
      audioOutput,
      outputClock,
      audioSession,
      store,
      getPlayer: () => ref.player,
    }),
    spectrogram,
    waveform: createEngineWaveform(store),
    decoder: createEngineDecoder({
      store,
      sampleRate: context.sampleRate,
      playerPort: playerChannel.port1,
      spectrogramPort: spectrogramChannel.port1,
      playheadPort: decoderPlayheadChannel.port2,
      onRecordingPeaksChanged: (message) => {
        ref.waveform.applyRecordingPeakPatch(message);
      },
      onRecordingsChanged: (recordings) => {
        store.update((state) => {
          state.recordings = recordings;
        });
      },
      onRecordingContentChanged: (recordingId) => {
        if (getActiveRecording(store.get())?.id === recordingId) {
          ref.waveform.refreshRecording();
        }
      },
      onRecordingStreamFailed: () => {
        void ref.player.stop();
      },
      onPlayerPlayRequested: () => {
        void ref.player.applyRemotePlayState({
          playing: true,
          recording: false,
        });
      },
      onPlayerRecordRequested: () => {
        void ref.player.applyRemotePlayState({
          playing: true,
          recording: true,
        });
      },
      onPlayerStopRequested: () => {
        void ref.player.applyRemoteStop();
      },
      onPlayerFrameIndexChanged: (frameIndex, frozen, revision, source) => {
        ref.player.applyRemoteFrameIndex(frameIndex, frozen, revision, source);
      },
      onPlayerRevisionChanged: (revision) => {
        const currentState = store.get();

        if (
          currentState.backendRevision === revision &&
          !currentState.playerFrameIndexPending
        ) {
          return;
        }

        store.update((state) => {
          state.backendRevision = revision;
          state.playerFrameIndexPending = false;
        });
      },
      onPlayerSyncState: (syncState) => {
        void ref.player.applyRemoteSyncState(syncState);
      },
    }),
    player: createEnginePlayer({
      context,
      audioOutput,
      outputClock,
      audioSession,
      store,
      decoderPort: playerChannel.port2,
      getDecoder: () => ref.decoder,
      playheadPort: playerPlayheadChannel.port2,
      fundamentalPort: fundamentalFramesChannel.port2,
      playheadPorts: [
        playerPlayheadChannel.port1,
        decoderPlayheadChannel.port1,
        spectrogramPlayheadChannel.port1,
      ],
    }),
    boot: async () => {
      await Promise.all([
        ref.player.boot(),
        ref.decoder.boot(),
        ref.spectrogram.boot(),
        ref.waveform.boot(),
      ]);
    },
  };

  if (capturedTap) {
    // eslint-disable-next-line musetric/no-global-state -- the measure build gives the external driver one entry point
    Object.assign(globalThis, {
      musetricMeasureHooks: { engine: ref, listenCaptured: capturedTap.listen },
    });
  }

  return ref;
};
