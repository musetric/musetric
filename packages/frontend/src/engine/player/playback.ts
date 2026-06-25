import {
  playerChannel,
  playerProcessorName,
  type StemType,
  stemTypes,
} from '@musetric/audio';
import {
  type ControlledPromise,
  createControlledPromise,
  nextNumber,
} from '@musetric/utils';
import { type Store } from '../../common/store.js';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineState } from '../state.js';
import playerWorkletUrl from './player.worklet.ts?worker&url';

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
    samples: Float32Array<SharedArrayBuffer>;
    metadata: Int32Array<SharedArrayBuffer>;
    notificationPort: MessagePort;
  }) => void;
  flushRecording: () => Promise<number>;
};

export const createEngineStubPlayback = (): EnginePlayback => ({
  boot: async () => {
    // nothing
  },
  play: async () => {
    // nothing
  },
  stop: async () => Promise.resolve(0),
  setFrozen: () => {
    // nothing
  },
  seek: () => {
    // nothing
  },
  connectRecordingSource: () => {
    return () => {
      // nothing
    };
  },
  startRecording: () => {
    // nothing
  },
  flushRecording: async () => Promise.resolve(0),
});

export type CreateEnginePlaybackOptions = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  store: Store<EngineState>;
  decoderPort: MessagePort;
  onFrameIndexChanged?: (frameIndex: number) => void;
  onPlaybackEnded?: () => void;
};

type PlayingWaiter = {
  revision: number;
  resolve: (frameIndex: number) => void;
};

const dbToGain = (db: number) => 10 ** (db / 20);

export const createEnginePlayback = async (
  options: CreateEnginePlaybackOptions,
): Promise<EnginePlayback> => {
  const { context, audioOutput, store, decoderPort, onFrameIndexChanged } =
    options;
  const { onPlaybackEnded } = options;
  await context.audioWorklet.addModule(playerWorkletUrl);
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

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    recordingFlushed: (message) => {
      recordingFlushPromise?.resolve(message.sequence);
      recordingFlushPromise = undefined;
    },
    setPlaying: (message) => {
      const currentRevision = isCurrentRevision(message.revision);
      if (currentRevision) {
        store.update((state) => {
          state.playing = message.playing;
          state.frameIndex = message.frameIndex;
          if (message.positionJump) {
            state.seekEvent = {
              revision: nextNumber(state.seekEvent.revision),
              frameIndex: message.frameIndex,
              origin: 'playbackEnd',
            };
          }
        });
      }
      if (currentRevision && !message.playing && message.positionJump) {
        onPlaybackEnded?.();
      }
      if (playingWaiter?.revision === message.revision) {
        playingWaiter.resolve(message.frameIndex);
        playingWaiter = undefined;
      }
    },
    setFrameIndex: (message) => {
      if (!isCurrentRevision(message.revision)) {
        return;
      }

      store.update((state) => {
        state.frameIndex = message.frameIndex;
      });
      onFrameIndexChanged?.(message.frameIndex);
    },
  });

  const publishTrackVolume = (stemType: StemType) => {
    const state = store.get();
    port.methods.setTrackVolume({
      stemType,
      volume: state.trackVolumes[stemType] * dbToGain(state.sourceGainDb),
    });
  };

  const subscribeTrackVolume = (stemType: StemType) => {
    store.subscribe(
      (state) => state.trackVolumes[stemType],
      () => publishTrackVolume(stemType),
    );
  };
  for (const stemType of stemTypes) {
    subscribeTrackVolume(stemType);
  }
  store.subscribe(
    (state) => state.sourceGainDb,
    () => {
      for (const stemType of stemTypes) {
        publishTrackVolume(stemType);
      }
    },
  );
  store.subscribe(
    (state) => state.trackVolumes.recording,
    (volume) => {
      port.methods.setRecordingVolume({
        volume,
      });
    },
  );

  store.subscribe(
    (state) => state.transposeSemitones,
    (transposeSemitones) => {
      port.methods.setTransposeSemitones({
        transposeSemitones,
      });
    },
  );
  store.subscribe(
    (state) => state.tempoBpm,
    (tempoBpm) => {
      const { sourceTempoBpm } = store.get();

      port.methods.setTempoRatio({
        tempoRatio: tempoBpm / sourceTempoBpm,
      });
    },
  );

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
  store.subscribe((state) => state.metronomeEnabled, publishMetronome);
  store.subscribe((state) => state.metronomeVolume, publishMetronome);
  store.subscribe((state) => state.metronomeBeats, publishMetronome);
  store.subscribe((state) => state.metronomeDownbeats, publishMetronome);

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
      });

      return bootPromise.promise;
    },
    play: async () => {
      if (context.state === 'suspended') {
        await context.resume();
      }
      await audioOutput.play();
      const { seekEvent, latencyFrameCount, inputLatencyFrameCount } =
        store.get();
      const { revision } = seekEvent;
      const playingPromise = createPlayingPromise(revision);
      port.methods.play({
        revision,
        latencyFrameCount,
        inputLatencyFrameCount,
      });
      await playingPromise;
    },
    stop: async () => {
      const { revision } = store.get().seekEvent;
      const playingPromise = createPlayingPromise(revision);
      port.methods.stop({ revision });
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
    flushRecording: async () => {
      recordingFlushPromise = createControlledPromise<number>();
      const currentPromise = recordingFlushPromise;
      port.methods.flushRecording();
      return await currentPromise.promise;
    },
  };

  return ref;
};
