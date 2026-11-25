/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { vi } from 'vitest';
import { type EngineAudioOutput } from '../../audioOutput/index.js';
import { type EngineOutputClock } from '../../audioOutput/outputClock.js';
import { createStore, type Store } from '../../common/store.js';
import { type EngineDecoder } from '../../decoder/index.js';
import { type EngineState, initialEngineState } from '../../state.js';
import {
  createGuardedPlayer,
  type GuardedPlayer,
  type PlayerFault,
} from '../guardedPlayer.worklet.js';
import { createEnginePlayer, type EnginePlayer } from '../index.js';
import { createEnginePosition, type EnginePosition } from '../position.js';
import { playerDataChannel } from '../protocol.cross.js';
import { recordingStreamChannel } from '../recordingStream.cross.js';
import { createMicrophone, type Microphone } from './microphone.fixtures.js';
import { blockSize, mountTracks, rate } from './player.fixtures.js';
import { isPortMessage, type PostHook, watchPosts } from './posts.fixtures.js';

const songSeconds = 8;
const screenFrameQuanta = 6;
const settleQuantumLimit = 2000;

const noop = (): void => undefined;

export const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
};

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const fake = <Type>(value: object): Type => value as Type;

export type Seam = {
  player: EnginePlayer;
  store: Store<EngineState>;
  position: EnginePosition;
  host: string[];
  toWorklet: string[];
  fromWorklet: string[];
  microphone: Microphone;
  onPostToWorklet: (type: string, hook: PostHook) => void;
  onPostFromWorklet: (type: string, hook: PostHook) => void;
  injectFault: (fault: PlayerFault) => void;
  postToWorklet: (message: unknown) => void;
  deliverFromWorklet: (message: unknown) => Promise<void>;
  hostFrames: () => number;
  run: (quanta: number) => Promise<void>;
  frame: () => Promise<void>;
  close: () => void;
};

type FakeWorklet = {
  player: GuardedPlayer;
  processing: boolean;
  post: (message: unknown) => void;
  deliver: (message: unknown) => void;
  reportError: (error: unknown) => void;
};

export type CreateSeamOptions = {
  before?: (store: Store<EngineState>) => void;
  bootFault?: true;
};

export const createSeam = async (
  options: CreateSeamOptions = {},
): Promise<Seam> => {
  const frameCount = songSeconds * rate;
  const store = createStore(initialEngineState);
  options.before?.(store);
  store.update((state) => {
    state.frameCount = frameCount;
  });
  const host: string[] = [];
  const toWorklet: string[] = [];
  const fromWorklet: string[] = [];
  let contextFrame = 0;
  let hostFrames = 0;
  let faulted = options.bootFault === true;
  let worklet: FakeWorklet | undefined = undefined;
  let onPostToWorklet: Seam['onPostToWorklet'] = noop;
  let onPostFromWorklet: Seam['onPostFromWorklet'] = noop;
  let animationCallbacks: FrameRequestCallback[] = [];

  class FakeAudioWorkletNode {
    readonly port: MessagePort;
    readonly connect = noop;
    readonly disconnect = noop;
    onprocessorerror: ((event: ErrorEvent) => void) | undefined = undefined;

    constructor() {
      const channel = new MessageChannel();
      this.port = channel.port1;
      if (options.bootFault) {
        const post = channel.port1.postMessage.bind(channel.port1);
        Object.assign(channel.port1, {
          postMessage: (message: unknown, transfer: Transferable[] = []) => {
            const boot = isPortMessage(message) && message.type === 'boot';
            post(boot ? { type: 'boot', payload: {} } : message, transfer);
          },
        });
      }
      onPostToWorklet = watchPosts(channel.port1, toWorklet);
      onPostFromWorklet = watchPosts(channel.port2, fromWorklet);
      worklet = {
        player: createGuardedPlayer({
          port: channel.port2,
          sampleRate: rate,
          getCurrentFrame: () => contextFrame,
          measure: true,
        }),
        processing: true,
        post: (message) => {
          channel.port1.postMessage(message);
        },
        deliver: (message) => {
          channel.port1.onmessage?.call(
            channel.port1,
            new MessageEvent('message', { data: message }),
          );
        },
        reportError: (error) => {
          setImmediate(() => {
            this.onprocessorerror?.(
              new ErrorEvent('processorerror', { message: String(error) }),
            );
          });
        },
      };
    }
  }

  const stretchBytes = readFileSync(
    createRequire(import.meta.url).resolve('@musetric/dsp/stretch.wasm'),
  );
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('fetch', async () =>
    Promise.resolve({ arrayBuffer: async () => Promise.resolve(stretchBytes) }),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationCallbacks.push(callback);
    return animationCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', noop);

  const context = fake<AudioContext>({
    sampleRate: rate,
    get currentTime() {
      return contextFrame / rate;
    },
    state: 'running',
    audioWorklet: { addModule: async () => Promise.resolve() },
    createGain: () => ({
      connect: noop,
      disconnect: noop,
      gain: { value: 1, setValueAtTime: noop },
    }),
  });
  const audioOutput = fake<EngineAudioOutput>({
    outputNode: {},
    supportsDeviceSelection: false,
    getDeviceId: () => undefined,
    setDeviceId: async () => Promise.resolve(),
    play: async () => Promise.resolve(),
  });
  const outputClock: EngineOutputClock = {
    read: () => undefined,
    subscribe: () => noop,
    whenSettled: async () => Promise.resolve(),
    wake: async () => Promise.resolve(),
  };
  const startRecordingStream: EngineDecoder['startRecordingStream'] = (
    recording,
  ) => {
    host.push('recording.start');
    recordingStreamChannel.outbound(recording.port).bindHandlers({
      chunk: (message) => {
        hostFrames += message.samples.length;
      },
      flush: noop,
    });
  };
  const decoder = fake<EngineDecoder>({
    startRecordingStream,
    finishRecordingStream: async () => {
      host.push('recording.finish');
      return Promise.resolve();
    },
  });
  const microphone = createMicrophone();
  const data = new MessageChannel();
  const playhead = new MessageChannel();
  const spectrogramPlayhead = new MessageChannel();
  const position = createEnginePosition();
  const player = createEnginePlayer({
    context,
    audioOutput,
    outputClock,
    audioSession: microphone.session,
    store,
    decoderPort: data.port1,
    getDecoder: () => decoder,
    playheadPort: playhead.port2,
    playheadPorts: [playhead.port1, spectrogramPlayhead.port1],
    position,
  });
  await player.boot();
  const silence = new Float32Array(frameCount);
  mountTracks(
    playerDataChannel.outbound(data.port2),
    frameCount,
    { lead: [silence], backing: [silence], instrumental: [silence] },
    [],
  );
  await flush();

  const readWorklet = () => {
    if (!worklet) {
      throw new Error('The player has no node');
    }
    return worklet;
  };

  const run = async (quanta: number) => {
    for (let index = 0; index < quanta; index += 1) {
      const current = readWorklet();
      const outputs = [
        new Float32Array(blockSize),
        new Float32Array(blockSize),
      ];
      if (current.processing) {
        try {
          current.player.process([[new Float32Array(blockSize)]], outputs);
        } catch (error) {
          current.processing = false;
          current.reportError(error);
        }
      }
      contextFrame += blockSize;
      if ((index + 1) % screenFrameQuanta === 0) {
        await flush();
      }
    }
    await flush();
  };

  const clocked = async (command: Promise<void>): Promise<void> => {
    const state = { settled: false };
    const tracked = command.finally(() => {
      state.settled = true;
    });
    for (
      let quantum = 0;
      !state.settled && quantum < settleQuantumLimit;
      quantum += 1
    ) {
      await run(1);
    }
    return tracked;
  };

  return {
    player: {
      ...player,
      play: async () => clocked(player.play()),
      stop: async () => clocked(player.stop()),
    },
    store,
    position,
    host,
    toWorklet,
    fromWorklet,
    microphone,
    onPostToWorklet: (type, hook) => {
      onPostToWorklet(type, hook);
    },
    onPostFromWorklet: (type, hook) => {
      onPostFromWorklet(type, hook);
    },
    injectFault: (fault) => {
      faulted = true;
      const { injectFault } = readWorklet().player;
      if (!injectFault) {
        throw new Error('The player takes no fault');
      }
      injectFault(fault);
    },
    postToWorklet: (message) => {
      faulted = true;
      readWorklet().post(message);
    },
    deliverFromWorklet: async (message) => {
      readWorklet().deliver(message);
      await flush();
    },
    hostFrames: () => hostFrames,
    run,
    frame: async () => {
      await flush();
      const callbacks = animationCallbacks;
      animationCallbacks = [];
      for (const callback of callbacks) {
        callback(contextFrame / rate);
      }
      await flush();
    },
    close: () => {
      data.port2.close();
      playhead.port2.close();
      spectrogramPlayhead.port2.close();
      vi.unstubAllGlobals();
      if (!faulted && store.get().statuses.player === 'error') {
        throw new Error('The player failed though the test injected no fault');
      }
    },
  };
};
