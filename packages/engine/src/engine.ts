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
  createEnginePosition,
  type EnginePosition,
} from './player/position.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram/index.js';
import {
  type EngineState,
  getActiveRecording,
  initialEngineState,
} from './state.js';
import { createEngineWaveform, type EngineWaveform } from './waveform/index.js';

const androidOutputBufferSeconds = 0.02;
const measure = import.meta.env.frontendMeasure === 'true';

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
  position: EnginePosition;
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
  const store = createStore(initialEngineState);
  const position = createEnginePosition();
  const spectrogramChannel = new MessageChannel();
  const spectrogramPlayheadChannel = new MessageChannel();
  const spectrogram = createEngineSpectrogram({
    store,
    sampleRate: context.sampleRate,
    decoderPort: spectrogramChannel.port2,
    playheadPort: spectrogramPlayheadChannel.port2,
    position,
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
      playheadPorts: [
        playerPlayheadChannel.port1,
        spectrogramPlayheadChannel.port1,
      ],
      position,
    }),
    position,
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
      musetricMeasureHooks: {
        engine: ref,
        outputClock,
        listenCaptured: capturedTap.listen,
      },
    });
  }

  return ref;
};
