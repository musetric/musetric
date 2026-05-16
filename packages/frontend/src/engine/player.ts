import {
  playerChannel,
  playerProcessorName,
  type StemType,
  stemTypes,
} from '@musetric/audio';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/resource-utils';
import type { Store } from '../common/store.js';
import playerWorkletUrl from './player.worklet.ts?worker&url';
import { type EngineState } from './state.js';

export type EnginePlayer = {
  boot: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<number>;
  setFrozen: (frozen: boolean) => void;
  seek: (frameIndex: number) => void;
  connectRecordingSource: (source: AudioNode) => () => void;
  startRecording: (options: {
    frameIndex: number;
    latencyFrameCount: number;
    samples: Float32Array<SharedArrayBuffer>;
    metadata: Int32Array<SharedArrayBuffer>;
    notificationPort: MessagePort;
  }) => void;
  seekRecording: (frameIndex: number) => void;
  flushRecording: () => Promise<number>;
};

export const createEngineStubPlayer = (): EnginePlayer => ({
  boot: async () => {
    // nothing
  },
  play: async () => {
    // nothing
  },
  pause: async () => Promise.resolve(0),
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
  seekRecording: () => {
    // nothing
  },
  flushRecording: async () => Promise.resolve(0),
});

export type CreateEnginePlayerOptions = {
  context: AudioContext;
  store: Store<EngineState>;
  decoderPort: MessagePort;
};

export const createEnginePlayer = async (
  options: CreateEnginePlayerOptions,
): Promise<EnginePlayer> => {
  const { context, store, decoderPort } = options;
  await context.audioWorklet.addModule(playerWorkletUrl);
  const node = new AudioWorkletNode(context, playerProcessorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(context.destination);
  const port = playerChannel.outbound(node.port);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let pausePromise: ControlledPromise<number> | undefined = undefined;
  let recordingFlushPromise: ControlledPromise<number> | undefined = undefined;

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    recordingFlushed: (message) => {
      recordingFlushPromise?.resolve(message.sequence);
      recordingFlushPromise = undefined;
    },
    setPlaying: (message) => {
      store.update((state) => {
        state.playing = message.playing;
        state.frameIndex = message.frameIndex;
        if (message.positionJump) {
          state.seekRevision += 1;
        }
      });
      if (!message.playing) {
        pausePromise?.resolve(message.frameIndex);
        pausePromise = undefined;
      }
    },
    setFrameIndex: (message) => {
      store.update((state) => {
        state.frameIndex = message.frameIndex;
        if (message.positionJump) {
          state.seekRevision += 1;
        }
      });
    },
  });

  const subscribeTrackVolume = (stemType: StemType) => {
    store.subscribe(
      (state) => state.trackVolumes[stemType],
      (volume) => {
        port.methods.setTrackVolume({
          stemType,
          volume,
        });
      },
    );
  };
  for (const stemType of stemTypes) {
    subscribeTrackVolume(stemType);
  }
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

  const ref: EnginePlayer = {
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
      port.methods.play();
    },
    pause: async () => {
      pausePromise = createControlledPromise<number>();
      const currentPromise = pausePromise;
      port.methods.pause();
      return await currentPromise.promise;
    },
    setFrozen: (frozen) => {
      store.update((state) => {
        state.frozen = frozen;
      });
      port.methods.setFrozen({ frozen });
    },
    seek: (nextFrameIndex) => {
      port.methods.seek({
        frameIndex: nextFrameIndex,
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
    seekRecording: (frameIndex) => {
      port.methods.seekRecording({
        frameIndex,
      });
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
