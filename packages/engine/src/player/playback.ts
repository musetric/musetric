import { type StemType, stemTypes } from '@musetric/audio/es';
import stretchWasmUrl from '@musetric/dsp/stretch.wasm?url';
import {
  type ControlledPromise,
  createControlledPromise,
  nextNumber,
} from '@musetric/utils';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { type Store } from '../common/store.js';
import {
  type EngineState,
  getInputShareFrameCount,
  getOutputLatencyFrameCount,
  getRecordingLatencyFrameCount,
} from '../state.js';
import playerWorkletUrl from './player.worklet.ts?worker&url';
import { createPlayhead } from './playhead.cross.js';
import { type EnginePositionWriter } from './position.js';
import { playerChannel, playerProcessorName } from './protocol.cross.js';
import { type EngineTrackKey } from './settings.js';

const noop = (): void => undefined;

export type EnginePlayback = {
  boot: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => Promise<number>;
  setFrozen: (frozen: boolean) => void;
  seek: (frameIndex: number) => void;
  connectRecordingSource: (source: AudioNode) => () => void;
  startRecording: (options: {
    frameIndex: number;
    revision: number;
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
    notificationPort: MessagePort;
    pass?: boolean;
  }) => void;
  flushRecording: () => Promise<number>;
  sendTempoRatio: () => void;
  sendTranspose: () => void;
  sendVoice: () => void;
  sendMetronome: () => void;
  sendTrackVolume: (track: EngineTrackKey) => void;
  sendTrackVolumes: () => void;
};

export const createEngineStubPlayback = (): EnginePlayback => ({
  boot: async () => Promise.resolve(),
  play: async () => Promise.resolve(),
  stop: async () => Promise.resolve(0),
  setFrozen: noop,
  seek: noop,
  connectRecordingSource: () => noop,
  startRecording: noop,
  flushRecording: async () => Promise.resolve(0),
  sendTempoRatio: noop,
  sendTranspose: noop,
  sendVoice: noop,
  sendMetronome: noop,
  sendTrackVolume: noop,
  sendTrackVolumes: noop,
});

const dbToGain = (db: number) => 10 ** (db / 20);

export type CreateEnginePlaybackOptions = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  outputClock: EngineOutputClock;
  store: Store<EngineState>;
  decoderPort: MessagePort;
  playheadPort: MessagePort;
  playheadPorts: MessagePort[];
  position: EnginePositionWriter;
  onPlaybackEnded?: () => void;
  onRecordingPassStarted?: () => void;
  onRecordingPassEnded?: (complete: boolean) => void;
};

type PlayingWaiter = {
  revision: number;
  resolve: (frameIndex: number) => void;
};

export const createEnginePlayback = async (
  options: CreateEnginePlaybackOptions,
): Promise<EnginePlayback> => {
  const { context, audioOutput, outputClock, store, decoderPort, position } =
    options;
  const { playheadPorts } = options;
  const { onPlaybackEnded, onRecordingPassStarted, onRecordingPassEnded } =
    options;
  const playhead = createPlayhead(options.playheadPort, context.sampleRate);
  const compiling = fetch(stretchWasmUrl)
    .then(async (response) => response.arrayBuffer())
    .then(WebAssembly.compile);
  await context.audioWorklet.addModule(playerWorkletUrl);
  const stretchModule = await compiling;
  const node = new AudioWorkletNode(context, playerProcessorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(audioOutput.outputNode);
  const port = playerChannel.outbound(node.port);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let playingWaiter: PlayingWaiter | undefined = undefined;
  let recordingFlushPromise: ControlledPromise<number> | undefined = undefined;

  const isCurrentRevision = (revision: number) =>
    store.get().seekEvent.revision === revision;

  let lastPumpedFrameIndex = -1;

  const frameIndexPump = createAnimationFrameLoop(() => {
    const value = playhead.read();
    const frameIndex = playhead.readFrameIndex();
    if (
      isCurrentRevision(value.revision) &&
      frameIndex !== lastPumpedFrameIndex
    ) {
      lastPumpedFrameIndex = frameIndex;
      position.write(frameIndex);
    }
    return store.get().playing || value.rate !== 0;
  });

  const startFrameIndexPump = () => {
    lastPumpedFrameIndex = -1;
    frameIndexPump.start();
  };

  const stopFrameIndexPump = () => {
    frameIndexPump.stop();
  };

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    recordingFlushed: (message) => {
      recordingFlushPromise?.resolve(message.sequence);
      recordingFlushPromise = undefined;
    },
    recordingPassStarted: () => {
      onRecordingPassStarted?.();
    },
    recordingPassEnded: (message) => {
      onRecordingPassEnded?.(message.complete);
    },
    setPlaying: (message) => {
      const currentRevision = isCurrentRevision(message.revision);
      if (currentRevision) {
        if (!message.glide) {
          position.write(message.frameIndex);
        }
        store.update((state) => {
          state.playing = message.playing;
          if (message.positionJump) {
            state.seekEvent = {
              revision: nextNumber(state.seekEvent.revision),
              frameIndex: message.frameIndex,
              origin: 'playbackEnd',
            };
          }
        });
        if (message.playing || message.glide) {
          startFrameIndexPump();
        } else {
          stopFrameIndexPump();
        }
      }
      if (currentRevision && !message.playing && message.positionJump) {
        onPlaybackEnded?.();
      }
      if (playingWaiter?.revision === message.revision) {
        playingWaiter.resolve(message.frameIndex);
        playingWaiter = undefined;
      }
    },
  });

  const publishTrackVolume = (stemType: StemType) => {
    const state = store.get();
    port.methods.setTrackVolume({
      stemType,
      volume: state.trackVolumes[stemType] * dbToGain(state.sourceGainDb),
    });
  };

  const sendRecordingVolume = () => {
    port.methods.setRecordingVolume({
      volume: store.get().trackVolumes.recording,
    });
  };
  const sendTrackVolume = (track: EngineTrackKey) => {
    if (track === 'recording') {
      sendRecordingVolume();
      return;
    }
    publishTrackVolume(track);
  };
  const sendTrackVolumes = () => {
    for (const stemType of stemTypes) {
      publishTrackVolume(stemType);
    }
    sendRecordingVolume();
  };
  const sendTranspose = () => {
    port.methods.setTransposeSemitones({
      transposeSemitones: store.get().transposeSemitones,
    });
  };
  const sendVoice = () => {
    const { voiceOctave, singerVoice } = store.get();
    port.methods.setVoiceOctave({
      voiceOctave,
      shifted: singerVoice === 'shifted',
    });
  };
  const sendTempoRatio = () => {
    port.methods.setTempoRatio({ tempoRatio: store.get().tempoRatio });
  };

  const getLatencyFrameCounts = () => {
    const state = store.get();
    return {
      latencyFrameCount: getRecordingLatencyFrameCount(state),
      inputLatencyFrameCount: getInputShareFrameCount(state),
    };
  };
  store.subscribe(getRecordingLatencyFrameCount, () => {
    port.methods.setLatency(getLatencyFrameCounts());
  });
  store.subscribe(getInputShareFrameCount, () => {
    port.methods.setLatency(getLatencyFrameCounts());
  });

  const publishOutputClock = () => {
    const reading = outputClock.read();
    if (!reading) {
      return;
    }
    const state = store.get();
    const addedFrameCount =
      getOutputLatencyFrameCount(state) - state.outputLatencyFrameCount;
    port.methods.setOutputClock({
      clockOffset: reading.clockOffset - addedFrameCount / context.sampleRate,
    });
  };
  outputClock.subscribe(publishOutputClock);
  store.subscribe(getOutputLatencyFrameCount, publishOutputClock);

  const publishMetronome = () => {
    const state = store.get();
    const beatsInSamples = new Int32Array(state.metronomeBeats.length);
    const downbeatMask = new Uint8Array(state.metronomeBeats.length);
    const downbeatSet = new Set(state.metronomeDownbeats);
    for (let i = 0; i < state.metronomeBeats.length; i += 1) {
      const beat = state.metronomeBeats[i];
      beatsInSamples[i] = Math.round(beat * context.sampleRate);
      downbeatMask[i] = downbeatSet.has(beat) ? 1 : 0;
    }
    port.methods.setMetronome({
      beatsInSamples,
      downbeatMask,
      enabled: state.metronomeEnabled,
      volume: state.metronomeVolume,
    });
  };
  const publishRange = () => {
    const { range, rangeRepeat, rangeStopFrame } = store.get();
    port.methods.setRange({
      range: range && { fromFrame: range.fromFrame, toFrame: range.toFrame },
      repeat: rangeRepeat,
      stopFrame: rangeStopFrame,
    });
  };
  store.subscribe((state) => state.range, publishRange);
  store.subscribe((state) => state.rangeRepeat, publishRange);
  store.subscribe((state) => state.rangeStopFrame, publishRange);

  const createPlayingPromise = async (revision: number) => {
    const playingPromise = createControlledPromise<number>();
    playingWaiter = {
      revision,
      resolve: playingPromise.resolve,
    };
    return playingPromise.promise;
  };

  const ref: EnginePlayback = {
    boot: async () => {
      port.methods.boot({
        dataPort: decoderPort,
        playheadPorts,
        stretchModule,
      });
      await bootPromise.promise;
      sendTempoRatio();
      sendTranspose();
      sendVoice();
      sendTrackVolumes();
      publishMetronome();
      publishRange();
    },
    play: async () => {
      await outputClock.wake();
      await audioOutput.play();
      const { revision } = store.get().seekEvent;
      const playingPromise = createPlayingPromise(revision);
      port.methods.play({ revision, ...getLatencyFrameCounts() });
      await playingPromise;
    },
    stop: async () => {
      const { revision } = store.get().seekEvent;
      const frameIndex = isCurrentRevision(playhead.read().revision)
        ? playhead.readFrameIndex()
        : position.read();
      const playingPromise = createPlayingPromise(revision);
      port.methods.stop({ revision, frameIndex });
      return await playingPromise;
    },
    setFrozen: (frozen) => {
      store.update((state) => {
        state.frozen = frozen;
      });
      port.methods.setFrozen({ frozen });
    },
    seek: (nextFrameIndex) => {
      const { revision } = store.get().seekEvent;
      port.methods.seek({
        frameIndex: nextFrameIndex,
        revision,
      });
    },
    connectRecordingSource: (source) => {
      source.connect(node);
      return () => {
        source.disconnect(node);
      };
    },
    startRecording: (recording) => {
      port.methods.startRecording(recording);
    },
    sendTempoRatio,
    sendTranspose,
    sendVoice,
    sendMetronome: publishMetronome,
    sendTrackVolume,
    sendTrackVolumes,
    flushRecording: async () => {
      recordingFlushPromise = createControlledPromise<number>();
      const currentPromise = recordingFlushPromise;
      port.methods.flushRecording();
      return await currentPromise.promise;
    },
  };

  return ref;
};
