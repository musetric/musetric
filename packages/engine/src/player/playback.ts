import stretchWasmUrl from '@musetric/dsp/stretch.wasm?url';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { type Store } from '../common/store.js';
import { type EngineStoreState } from '../ownState.js';
import {
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
import {
  playerChannel,
  type PlayerInboundMethods,
  type PlayerMotion,
  playerProcessorName,
} from './protocol.cross.js';
import { type EngineSeeksWriter } from './seeks.js';

export type EnginePlayback = PlaybackSettings & {
  boot: () => Promise<boolean>;
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

export type CreateEnginePlaybackOptions = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  outputClock: EngineOutputClock;
  store: Store<EngineStoreState>;
  dataPort: MessagePort;
  playheadPort: MessagePort;
  mounted: boolean;
  position: EnginePositionWriter;
  seeks: EngineSeeksWriter;
  onPlaybackEnded?: () => void;
  applyMotion: (motion: PlayerMotion) => void;
  onRecordingPassStarted?: () => void;
  onRecordingPassEnded?: (complete: boolean) => void;
  onFailed: () => void;
};

type PlayingAck = { frameIndex: number; playing: boolean };

type PlayingReply = Parameters<PlayerInboundMethods['setPlaying']>[0];

type PlayingWaiter = {
  command: number;
  resolve: (ack: PlayingAck) => void;
};

export const createEnginePlayback = async (
  options: CreateEnginePlaybackOptions,
): Promise<EnginePlayback> => {
  const { context, audioOutput, outputClock, store, position, seeks } = options;
  const { onPlaybackEnded, onRecordingPassStarted, onRecordingPassEnded } =
    options;
  const playheadChannel = new MessageChannel();
  const playhead = createPlayhead(context.sampleRate);
  playhead.connect(playheadChannel.port2);
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
  node.connect(audioOutput.getOutputNode());
  let booted = false;
  let failed = false;
  const port = playerChannel.outboundSync(node.port, (handler, payload) => {
    if (!failed) {
      handler(payload);
    }
  });
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  const mountPromise = createControlledPromise<void>();
  const playingWaiters: PlayingWaiter[] = [];
  let sentCommand = 0;
  const nextCommand = () => {
    sentCommand += 1;
    return sentCommand;
  };
  let recordingFlushPromise: ControlledPromise<number> | undefined = undefined;
  const unsubscribes: (() => void)[] = [];

  const unlessHalted = async <Value>(promise: Promise<Value>) => {
    const halted = createControlledPromise<undefined>();
    const check = () => {
      if (context.state !== 'running') {
        halted.resolve(undefined);
      }
    };
    context.addEventListener('statechange', check);
    check();
    try {
      return await Promise.race([promise, halted.promise]);
    } finally {
      context.removeEventListener('statechange', check);
    }
  };

  const isCurrentRevision = (revision: number) =>
    seeks.read().revision === revision;

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

  const fail = (reason: string) => {
    if (failed) {
      return;
    }
    failed = true;
    console.error('The player failed on the audio thread:', reason);
    node.port.close();
    node.disconnect();
    for (const unsubscribe of unsubscribes.splice(0)) {
      unsubscribe();
    }
    stopFrameIndexPump();
    if (booted && isCurrentRevision(playhead.read().revision)) {
      position.write(playhead.readFrameIndex());
    }
    const frameIndex = position.read();
    for (const waiter of playingWaiters.splice(0)) {
      waiter.resolve({ frameIndex, playing: false });
    }
    recordingFlushPromise?.resolve(0);
    recordingFlushPromise = undefined;
    bootPromise.resolve();
    mountPromise.resolve();
    store.update((state) => {
      state.statuses.player = 'error';
    });
    seeks.push(frameIndex, 'playbackEnd');
    if (booted) {
      options.onFailed();
    }
  };

  const followReply = (message: PlayingReply, currentRevision: boolean) => {
    if (currentRevision && !message.glide) {
      position.write(message.frameIndex);
    }
    options.applyMotion(message.motion);
    if (currentRevision && message.positionJump) {
      seeks.push(message.frameIndex, 'playbackEnd');
    }
    if (message.playing || message.glide) {
      startFrameIndexPump();
    } else {
      stopFrameIndexPump();
    }
  };

  node.onprocessorerror = (event) => {
    fail(event.message);
  };

  port.bindHandlers({
    booted: () => {
      booted = true;
      store.update((state) => {
        state.statuses.player = 'success';
      });
      bootPromise.resolve();
    },
    mounted: () => {
      mountPromise.resolve();
    },
    failed: (message) => {
      fail(message.reason);
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
        followReply(message, currentRevision);
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

  const publishRange = () => {
    const { range, rangeRepeat, rangeStopFrame } = store.get();
    port.methods.setRange({
      command: nextCommand(),
      range: range && { fromFrame: range.fromFrame, toFrame: range.toFrame },
      repeat: rangeRepeat,
      stopFrame: rangeStopFrame,
    });
  };
  unsubscribes.push(
    store.subscribe(getRecordingLatencyFrameCount, () => {
      port.methods.setLatency(getLatencyFrameCounts());
    }),
    store.subscribe(getInputShareFrameCount, () => {
      port.methods.setLatency(getLatencyFrameCounts());
    }),
    outputClock.subscribe(publishOutputClock),
    store.subscribe(getOutputLatencyFrameCount, publishOutputClock),
    store.subscribe((state) => state.range, publishRange),
    store.subscribe((state) => state.rangeRepeat, publishRange),
    store.subscribe((state) => state.rangeStopFrame, publishRange),
  );

  const createPlayingPromise = async (command: number) => {
    const playingPromise = createControlledPromise<PlayingAck>();
    playingWaiters.push({ command, resolve: playingPromise.resolve });
    return playingPromise.promise;
  };

  const ref: EnginePlayback = {
    boot: async () => {
      port.methods.boot({
        dataPort: options.dataPort,
        playheadPorts: [playheadChannel.port1, options.playheadPort],
        stretchModule,
      });
      await bootPromise.promise;
      if (options.mounted) {
        await mountPromise.promise;
      }
      publishOutputClock();
      settings.sendTempoRatio();
      settings.sendTranspose();
      settings.sendVoice();
      settings.sendTrackVolumes();
      settings.sendMetronome();
      publishRange();
      return !failed;
    },
    play: async () => {
      await outputClock.wake();
      await audioOutput.play();
      if (failed) {
        return false;
      }
      const { revision } = seeks.read();
      const command = nextCommand();
      const playingPromise = createPlayingPromise(command);
      port.methods.play({ command, revision, ...getLatencyFrameCounts() });
      return (await playingPromise).playing;
    },
    stop: async () => {
      if (failed) {
        return position.read();
      }
      const { revision } = seeks.read();
      const frameIndex = isCurrentRevision(playhead.read().revision)
        ? playhead.readFrameIndex()
        : position.read();
      const command = nextCommand();
      const playingPromise = createPlayingPromise(command);
      port.methods.stop({ command, revision, frameIndex });
      const reply = await unlessHalted(playingPromise);
      if (reply) {
        return reply.frameIndex;
      }
      stopFrameIndexPump();
      position.write(frameIndex);
      options.applyMotion('stopped');
      return frameIndex;
    },
    setFrozen: (frozen) => {
      store.update((state) => {
        state.frozen = frozen;
      });
      port.methods.setFrozen({ command: nextCommand(), frozen });
    },
    seek: (nextFrameIndex) => {
      const { revision } = seeks.read();
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
      if (failed) {
        return 0;
      }
      recordingFlushPromise = createControlledPromise<number>();
      const currentPromise = recordingFlushPromise;
      port.methods.flushRecording();
      return (await unlessHalted(currentPromise.promise)) ?? 0;
    },
  };

  return ref;
};
