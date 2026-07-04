import { defaultSpectrogramConfig } from '@musetric/spectrogram';
import { defaultSampleRate } from '@musetric/utils';
import {
  createEngineAudioOutput,
  type EngineAudioOutput,
} from './audioOutput/index.js';
import {
  createEngineCalibration,
  type EngineCalibration,
} from './calibration/index.js';
import { createStore, type Store } from './common/store.js';
import { createEngineDecoder, type EngineDecoder } from './decoder/index.js';
import { createEnginePlayer, type EnginePlayer } from './player/index.js';
import { createPlayhead } from './player/playhead.cross.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram/index.js';
import { type EngineState } from './state.js';
import { createEngineWaveform, type EngineWaveform } from './waveform/index.js';

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
  spectrogramView: 'spectrum',
  duration: 0,
  playing: false,
  frozen: false,
  recording: false,
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
  sourceTempoBpm: 100,
  tempoBpm: 100,
  audioDevices: [],
  latencyFrameCount: 0,
  inputLatencyFrameCount: 0,
  latencySource: 'estimated',
  calibrating: false,
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
};

export type Engine = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  store: Store<EngineState>;
  calibration: EngineCalibration;
  decoder: EngineDecoder;
  spectrogram: EngineSpectrogram;
  waveform: EngineWaveform;
  player: EnginePlayer;
  boot: () => Promise<void>;
};

export const createEngine = (): Engine => {
  const context = new AudioContext({ sampleRate: defaultSampleRate });
  const audioOutput = createEngineAudioOutput(context);
  const store = createStore(initialState);
  const playhead = createPlayhead();
  const playerChannel = new MessageChannel();
  const spectrogramChannel = new MessageChannel();

  const ref: Engine = {
    context,
    audioOutput,
    store,
    calibration: createEngineCalibration({
      context,
      audioOutput,
      store,
      getPlayer: () => ref.player,
    }),
    spectrogram: createEngineSpectrogram({
      store,
      sampleRate: context.sampleRate,
      decoderPort: spectrogramChannel.port2,
      playhead,
    }),
    waveform: createEngineWaveform(store),
    decoder: createEngineDecoder({
      store,
      sampleRate: context.sampleRate,
      playerPort: playerChannel.port1,
      spectrogramPort: spectrogramChannel.port1,
      playhead,
      onRecordingPeaksChanged: (message) => {
        ref.waveform.applyRecordingPeakPatch({
          startPeakIndex: message.startPeakIndex,
          peaks: message.peaks,
        });
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
      store,
      decoderPort: playerChannel.port2,
      getDecoder: () => ref.decoder,
      playhead,
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

  return ref;
};
