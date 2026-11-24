/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@musetric/dsp/stretch';
import { vi } from 'vitest';
import { type EngineAudioOutput } from '../../audioOutput/index.js';
import { type EngineOutputClock } from '../../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../../audioSession/engineAudioSession.js';
import { createStore, type Store } from '../../common/store.js';
import { type EngineDecoder } from '../../decoder/index.js';
import { type EngineState, initialEngineState } from '../../state.js';
import { createEnginePlayer, type EnginePlayer } from '../index.js';
import { createEnginePosition, type EnginePosition } from '../position.js';
import { playerChannel, playerDataChannel } from '../protocol.cross.js';
import { createPlayerRuntime, type PlayerRuntime } from '../runtime.worklet.js';
import { blockSize, mountTracks, rate } from './player.fixtures.js';

const songSeconds = 8;
const screenFrameQuanta = 6;

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

type PortMessage = { type: string; payload: unknown };

const isPortMessage = (value: unknown): value is PortMessage =>
  value instanceof Object && 'type' in value;

type PostHook = (payload: unknown) => void;

const watchPosts = (port: MessagePort, posted: string[]) => {
  const hooks = new Map<string, PostHook>();
  const post = port.postMessage.bind(port);
  const postWatched = (message: unknown, transfer: Transferable[] = []) => {
    post(message, transfer);
    if (!isPortMessage(message)) {
      return;
    }
    posted.push(message.type);
    const hook = hooks.get(message.type);
    if (hook) {
      hooks.delete(message.type);
      hook(message.payload);
    }
  };
  Object.assign(port, { postMessage: postWatched });
  return (type: string, hook: PostHook) => {
    hooks.set(type, hook);
  };
};

export type Microphone = {
  open: () => void;
};

const createMicrophone = (): { session: EngineAudioSession } & Microphone => {
  let opened: (() => void) | undefined = undefined;
  const microphone: EngineMicrophone = {
    getSettings: () => ({}),
    getMeasuredInputLatency: () => 0,
    whenInputLatencyMeasured: async () => Promise.resolve(),
    createSource: () => fake<AudioNode>({ connect: noop, disconnect: noop }),
  };
  return {
    session: {
      openMicrophone: async () =>
        new Promise<EngineMicrophone>((resolve) => {
          opened = () => {
            resolve(microphone);
          };
        }),
      closeMicrophone: noop,
      enumerateDevices: async () => Promise.resolve([]),
      subscribeDevices: () => noop,
      readMicrophoneDenial: () => undefined,
      canOpenMicrophoneSettings: () => false,
      openMicrophoneSettings: noop,
    },
    open: () => {
      opened?.();
    },
  };
};

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
  run: (quanta: number) => Promise<void>;
  frame: () => Promise<void>;
  close: () => void;
};

export const createSeam = async (): Promise<Seam> => {
  const frameCount = songSeconds * rate;
  const store = createStore(initialEngineState);
  store.update((state) => {
    state.frameCount = frameCount;
  });
  const host: string[] = [];
  const toWorklet: string[] = [];
  const fromWorklet: string[] = [];
  let contextFrame = 0;
  let runtime: PlayerRuntime | undefined = undefined;
  let onPostToWorklet: Seam['onPostToWorklet'] = noop;
  let onPostFromWorklet: Seam['onPostFromWorklet'] = noop;
  let animationCallbacks: FrameRequestCallback[] = [];

  class FakeAudioWorkletNode {
    readonly port: MessagePort;
    readonly connect = noop;
    readonly disconnect = noop;

    constructor() {
      const channel = new MessageChannel();
      this.port = channel.port1;
      onPostToWorklet = watchPosts(channel.port1, toWorklet);
      onPostFromWorklet = watchPosts(channel.port2, fromWorklet);
      const port = playerChannel.inbound(channel.port2);
      port.bindBoot((message) => {
        runtime = createPlayerRuntime({
          port,
          dataPort: playerDataChannel.inbound(message.dataPort),
          playheadPorts: message.playheadPorts,
          sampleRate: rate,
          stretch: initSync({ module: message.stretchModule }),
          getCurrentTime: () => contextFrame / rate,
          getCurrentFrame: () => contextFrame,
        });
        port.methods.booted();
      });
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
  const record = (method: string) => () => {
    host.push(method);
  };
  const decoder = fake<EngineDecoder>({
    sendPlayerPlay: record('player.play'),
    sendPlayerRecord: record('player.record'),
    sendPlayerStop: record('player.stop'),
    sendPlayerFrameIndex: record('player.frameIndex'),
    sendPlayerSyncRequest: record('player.sync'),
    startRecordingStream: record('recording.start'),
    finishRecordingStream: async () => {
      host.push('recording.finish');
      return Promise.resolve();
    },
  });
  const microphone = createMicrophone();
  const data = new MessageChannel();
  const playhead = new MessageChannel();
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
    playheadPorts: [playhead.port1],
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

  const run = async (quanta: number) => {
    for (let index = 0; index < quanta; index += 1) {
      if (!runtime) {
        throw new Error('The player has not booted');
      }
      const outputs = [
        new Float32Array(blockSize),
        new Float32Array(blockSize),
      ];
      runtime.process([[new Float32Array(blockSize)]], outputs);
      contextFrame += blockSize;
      if ((index + 1) % screenFrameQuanta === 0) {
        await flush();
      }
    }
    await flush();
  };

  return {
    player,
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
      vi.unstubAllGlobals();
    },
  };
};
