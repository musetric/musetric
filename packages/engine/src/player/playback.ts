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
  isPlaying,
} from '../state.js';
import {
  createPlaybackSettings,
  type PlaybackSettings,
} from './playbackSettings.js';
import playerWorkletUrl from './player.worklet.ts?worker&url';
import { createPlayhead } from './playhead.cross.js';
import { type EnginePositionWriter } from './position.js';
import { playerChannel, playerProcessorName } from './protocol.cross.js';

const noop = (): void => undefined;

export type EnginePlayback = PlaybackSettings & {
  boot: () => Promise<void>;
  play: () => Promise<boolean>;
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
};

export const createEngineStubPlayback = (): EnginePlayback => ({
  boot: async () => Promise.resolve(),
  play: async () => Promise.resolve(false),
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
  applyMotion: (playing: boolean) => void;
  onRecordingPassStarted?: () => void;
  onRecordingPassEnded?: (complete: boolean) => void;
};

type PlayingAck = { frameIndex: number; playing: boolean };

type PlayingWaiter = {
  command: number;
  resolve: (ack: PlayingAck) => void;
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
  const playingWaiters: PlayingWaiter[] = [];
  let sentCommand = 0;
  const nextCommand = () => {
    sentCommand += 1;
    return sentCommand;
  };
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
    return isPlaying(store.get()) || value.rate !== 0;
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
      if (message.command === sentCommand) {
        if (currentRevision && !message.glide) {
          position.write(message.frameIndex);
        }
        options.applyMotion(message.playing);
        store.update((state) => {
          if (currentRevision && message.positionJump) {
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
      for (const waiter of playingWaiters.splice(0)) {
        if (waiter.command <= message.command) {
          waiter.resolve(message);
        } else {
          playingWaiters.push(waiter);
        }
      }
    },
  });

  const settings = createPlaybackSettings({
    port,
    store,
    sampleRate: context.sampleRate,
  });

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

  const publishRange = () => {
    const { range, rangeRepeat, rangeStopFrame } = store.get();
    port.methods.setRange({
      command: nextCommand(),
      range: range && { fromFrame: range.fromFrame, toFrame: range.toFrame },
      repeat: rangeRepeat,
      stopFrame: rangeStopFrame,
    });
  };
  store.subscribe((state) => state.range, publishRange);
  store.subscribe((state) => state.rangeRepeat, publishRange);
  store.subscribe((state) => state.rangeStopFrame, publishRange);

  const createPlayingPromise = async (command: number) => {
    const playingPromise = createControlledPromise<PlayingAck>();
    playingWaiters.push({ command, resolve: playingPromise.resolve });
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
      settings.sendTempoRatio();
      settings.sendTranspose();
      settings.sendVoice();
      settings.sendTrackVolumes();
      settings.sendMetronome();
      publishRange();
    },
    play: async () => {
      await outputClock.wake();
      await audioOutput.play();
      const { revision } = store.get().seekEvent;
      const command = nextCommand();
      const playingPromise = createPlayingPromise(command);
      port.methods.play({ command, revision, ...getLatencyFrameCounts() });
      return (await playingPromise).playing;
    },
    stop: async () => {
      const { revision } = store.get().seekEvent;
      const frameIndex = isCurrentRevision(playhead.read().revision)
        ? playhead.readFrameIndex()
        : position.read();
      const command = nextCommand();
      const playingPromise = createPlayingPromise(command);
      port.methods.stop({ command, revision, frameIndex });
      return (await playingPromise).frameIndex;
    },
    setFrozen: (frozen) => {
      store.update((state) => {
        state.frozen = frozen;
      });
      port.methods.setFrozen({ command: nextCommand(), frozen });
    },
    seek: (nextFrameIndex) => {
      const { revision } = store.get().seekEvent;
      port.methods.seek({
        command: nextCommand(),
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
    ...settings,
    flushRecording: async () => {
      recordingFlushPromise = createControlledPromise<number>();
      const currentPromise = recordingFlushPromise;
      port.methods.flushRecording();
      return await currentPromise.promise;
    },
  };

  return ref;
};
