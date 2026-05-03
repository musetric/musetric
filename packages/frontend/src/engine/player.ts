import {
  playerChannel,
  playerProcessorName,
  type StemType,
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
  pause: () => void;
  seek: (frameIndex: number) => void;
};

export const createEngineStubPlayer = (): EnginePlayer => ({
  boot: async () => {
    // nothing
  },
  play: async () => {
    // nothing
  },
  pause: () => {
    // nothing
  },
  seek: () => {
    // nothing
  },
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
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(context.destination);
  const port = playerChannel.outbound(node.port);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setPlaying: (message) => {
      store.update((state) => {
        state.playing = message.playing;
        state.frameIndex = message.frameIndex;
        if (message.positionJump) {
          state.seekRevision += 1;
        }
      });
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
  subscribeTrackVolume('lead');
  subscribeTrackVolume('backing');
  subscribeTrackVolume('instrumental');

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
    pause: () => {
      port.methods.pause();
    },
    seek: (nextFrameIndex) => {
      port.methods.seek({
        frameIndex: nextFrameIndex,
      });
    },
  };

  return ref;
};
