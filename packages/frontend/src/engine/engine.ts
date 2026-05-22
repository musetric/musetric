import { defaultSampleRate } from '@musetric/resource-utils';
import { createStore, type Store } from '../common/store.js';
import { createEngineDecoder, type EngineDecoder } from './decoder.js';
import { createEnginePlayer, type EnginePlayer } from './player/index.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram.js';
import { type EngineState } from './state.js';
import { createEngineWaveform, type EngineWaveform } from './waveform.js';

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
  colors: {
    background: '#000000',
    foreground: '#888888',
    primary: '#1976d2',
  },
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
  microphoneLatencyFrameCount: 0,
  microphoneLatencyUserSet: false,
  recordingGain: 1,
  trackVolumes: {
    lead: 1,
    backing: 1,
    instrumental: 1,
    recording: 1,
  },
};

export type Engine = {
  context: AudioContext;
  store: Store<EngineState>;
  decoder: EngineDecoder;
  spectrogram: EngineSpectrogram;
  waveform: EngineWaveform;
  player: EnginePlayer;
  boot: () => Promise<void>;
};

export const createEngine = (): Engine => {
  const context = new AudioContext({ sampleRate: defaultSampleRate });
  const store = createStore(initialState);
  const playerChannel = new MessageChannel();
  const spectrogramChannel = new MessageChannel();

  const ref: Engine = {
    context,
    store,
    spectrogram: createEngineSpectrogram({
      store,
      sampleRate: context.sampleRate,
      decoderPort: spectrogramChannel.port2,
    }),
    waveform: createEngineWaveform(store),
    decoder: createEngineDecoder({
      store,
      sampleRate: context.sampleRate,
      playerPort: playerChannel.port1,
      spectrogramPort: spectrogramChannel.port1,
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
      store,
      decoderPort: playerChannel.port2,
      getDecoder: () => ref.decoder,
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

export const engine = createEngine();
