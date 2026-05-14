import { defaultSampleRate } from '@musetric/resource-utils';
import { createStore, type Store } from '../common/store.js';
import { createEngineDecoder, type EngineDecoder } from './decoder.js';
import {
  createEnginePlayer,
  createEngineStubPlayer,
  type EnginePlayer,
} from './player.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram.js';
import { type EngineState } from './state.js';
import { createEngineWaveform, type EngineWaveform } from './waveform.js';

const initialState: EngineState = {
  statuses: {
    decoder: 'pending',
    spectrogram: 'pending',
    waveform: {
      lead: 'pending',
      backing: 'pending',
      instrumental: 'pending',
    },
  },
  colors: {
    background: '#000000',
    foreground: '#888888',
  },
  duration: 0,
  playing: false,
  recording: false,
  frameIndex: 0,
  seekRevision: 0,
  transposeSemitones: 0,
  sourceTempoBpm: 100,
  tempoBpm: 100,
  trackVolumes: {
    lead: 1,
    backing: 1,
    instrumental: 1,
  },
};

export type Engine = {
  context: AudioContext;
  store: Store<EngineState>;
  decoder: EngineDecoder;
  spectrogram: EngineSpectrogram;
  waveform: EngineWaveform;
  player: EnginePlayer;
  recorder: EngineRecorder;
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
    }),
    player: createEngineStubPlayer(),
    recorder: createEngineRecorder({
      context,
      store,
      getPlayer: () => ref.player,
    }),
    boot: async () => {
      ref.player = await createEnginePlayer({
        context,
        store,
        decoderPort: playerChannel.port2,
      });
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
