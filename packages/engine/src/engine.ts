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
import { createStore, type ReadonlyStore } from './common/store.js';
import { createEngineDecoder, type EngineDecoder } from './decoder/index.js';
import { createCapturedTap } from './measure/capturedTap.js';
import { type EngineStoreState, initialEngineState } from './ownState.js';
import { createEnginePlayer, type EnginePlayer } from './player/index.js';
import {
  createEnginePosition,
  type EnginePosition,
} from './player/position.js';
import { createEngineSeeks, type EngineSeeks } from './player/seeks.js';
import {
  createEngineSpectrogram,
  type EngineSpectrogram,
} from './spectrogram/index.js';
import { type EngineState, getActiveRecording } from './state.js';
import { createEngineView, type EngineView } from './view.js';
import { createEngineWaveform, type EngineWaveform } from './waveform/index.js';

const androidOutputBufferSeconds = 0.02;
const measure = import.meta.env.frontendMeasure === 'true';

const createAudioContext = () =>
  new AudioContext({
    sampleRate: defaultSampleRate,
    latencyHint: navigator.userAgent.includes('Android')
      ? androidOutputBufferSeconds
      : 'interactive',
  });

export type Engine = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  store: ReadonlyStore<EngineState>;
  calibration: EngineCalibration;
  microphoneAccess: EngineMicrophoneAccess;
  decoder: EngineDecoder;
  spectrogram: EngineSpectrogram;
  waveform: EngineWaveform;
  player: EnginePlayer;
  position: EnginePosition;
  seeks: EngineSeeks;
  view: EngineView;
  boot: () => Promise<void>;
};

export const createEngine = (): Engine => {
  let context = createAudioContext();
  const getContext = () => context;
  const outputClock = createEngineOutputClock(context);
  const store = createStore(initialEngineState);
  const position = createEnginePosition();
  const seeks = createEngineSeeks();
  const spectrogramChannel = new MessageChannel();
  const spectrogram = createEngineSpectrogram({
    store,
    sampleRate: context.sampleRate,
    decoderPort: spectrogramChannel.port2,
    position,
    seeks,
  });
  const capturedTap = measure ? createCapturedTap() : undefined;
  const audioSession = createEngineAudioSession(
    getContext,
    outputClock,
    (chunk) => {
      spectrogram.previewLiveTake(chunk);
      capturedTap?.push(chunk);
    },
  );
  const audioOutput = createEngineAudioOutput(
    context,
    audioSession.routesOutputBySystem === true,
  );
  const isClockNeeded = (state: EngineStoreState) =>
    state.session !== 'idle' || state.take !== 'none' || state.calibrating;
  outputClock.setActive(isClockNeeded(store.get()));
  store.subscribe(isClockNeeded, outputClock.setActive);
  outputClock.subscribe((reading) => {
    const frameCount = Math.round(reading.renderAhead * context.sampleRate);
    if (frameCount !== store.get().outputLatencyFrameCount) {
      store.update((state) => {
        state.outputLatencyFrameCount = frameCount;
      });
    }
  });

  const ref: Engine = {
    get context() {
      return context;
    },
    audioOutput,
    store,
    microphoneAccess: createEngineMicrophoneAccess({ store, audioSession }),
    calibration: createEngineCalibration({
      getContext,
      audioOutput,
      outputClock,
      audioSession,
      store,
      getPlayer: () => ref.player,
    }),
    spectrogram,
    waveform: createEngineWaveform(store),
    view: createEngineView(store),
    decoder: createEngineDecoder({
      store,
      sampleRate: context.sampleRate,
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
      onTakeRefused: (reason, streaming) => {
        store.update((state) => {
          state.takeRefusal = reason;
        });
        if (streaming) {
          void ref.player.stopRecording();
        }
      },
      onRealtimeLost: () => {
        void ref.player.stop();
      },
    }),
    player: createEnginePlayer({
      getContext,
      audioOutput,
      outputClock,
      audioSession,
      store,
      getDecoder: () => ref.decoder,
      position,
      seeks,
      connect: async () => {
        const data = new MessageChannel();
        const playhead = new MessageChannel();
        spectrogram.connectPlayhead(playhead.port2);
        return {
          dataPort: data.port2,
          playheadPort: playhead.port1,
          mounted: await ref.decoder.connectPlayer(data.port1),
        };
      },
      rebuildOutput: async () => {
        const previous = context;
        context = createAudioContext();
        outputClock.attach(context);
        await audioOutput.attach(context);
        await previous.close();
      },
    }),
    position,
    seeks,
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
