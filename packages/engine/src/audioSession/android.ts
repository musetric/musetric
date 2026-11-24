import { z } from 'zod';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  microphoneAccessDenied,
} from './engineAudioSession.js';
import {
  createNativeDeviceChanges,
  createNativeMicrophones,
  type NativeCaptureRequest,
  nativePortSchema,
  nativeStartSchema,
  toNativeDeviceInfos,
} from './nativeCapture.js';
import { type CapturedChunkListener } from './timedMicrophone.js';

const clockProbeCount = 9;

const devicesSchema = z.object({
  inputs: z.array(nativePortSchema),
  outputs: z.array(nativePortSchema),
  defaultInput: z.string().optional(),
  defaultOutput: z.string().optional(),
});

const messageSchema = z.union([
  z.object({ id: z.number(), error: z.string() }),
  z.object({ id: z.number(), result: z.unknown() }),
  z.object({ type: z.literal('devicechange') }),
]);

type AndroidMicrophoneBridge = {
  postMessage: (message: string) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

type AndroidClock = {
  now: () => number;
};

type AndroidMicrophoneWindow = Window & {
  MusetricMicrophone?: AndroidMicrophoneBridge;
  MusetricClock?: AndroidClock;
};

export type AndroidMicrophone = {
  bridge: AndroidMicrophoneBridge;
  clock: AndroidClock;
};

export const readAndroidMicrophone = (): AndroidMicrophone | undefined => {
  const target: AndroidMicrophoneWindow = window;
  const bridge = target.MusetricMicrophone;
  const clock = target.MusetricClock;
  return bridge && clock ? { bridge, clock } : undefined;
};

const measureClockOffset = (clock: AndroidClock) => {
  let bestSpan = Infinity;
  let offset = 0;
  for (let index = 0; index < clockProbeCount; index += 1) {
    const before = performance.now();
    const native = clock.now();
    const after = performance.now();
    if (after - before < bestSpan) {
      bestSpan = after - before;
      offset = native - (before + after) / 2;
    }
  }
  return offset;
};

const accessSchema = z.object({
  granted: z.boolean(),
});

const volumeSchema = z.object({
  volume: z.number(),
  steps: z.number(),
});

type AndroidMicrophoneCommand =
  | { type: 'devices' }
  | { type: 'access' }
  | { type: 'volume' }
  | { type: 'setVolume'; volume: number }
  | ({ type: 'start' } & NativeCaptureRequest)
  | { type: 'stop' }
  | { type: 'openSettings' };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export const createAndroidAudioSession = (
  getContext: () => AudioContext,
  outputClock: EngineOutputClock,
  android: AndroidMicrophone,
  onCaptured: CapturedChunkListener,
): EngineAudioSession => {
  const { bridge, clock } = android;
  const pending = new Map<number, PendingRequest>();
  const deviceChanges = createNativeDeviceChanges();
  let nextRequestId = 0;

  const request = async (command: AndroidMicrophoneCommand) =>
    new Promise<unknown>((resolve, reject) => {
      nextRequestId += 1;
      pending.set(nextRequestId, { resolve, reject });
      bridge.postMessage(JSON.stringify({ ...command, id: nextRequestId }));
    });

  const microphones = createNativeMicrophones({
    getContext,
    outputClock,
    onCaptured,
    capture: {
      readClockOffset: () => measureClockOffset(clock),
      start: async (captureRequest) =>
        nativeStartSchema.parse(
          await request({ type: 'start', ...captureRequest }),
        ),
      stop: async () => request({ type: 'stop' }),
    },
  });

  bridge.addEventListener('message', (event) => {
    const { data } = event;
    if (data instanceof ArrayBuffer) {
      microphones.receive(data);
      return;
    }
    if (typeof data !== 'string') {
      return;
    }
    const message = messageSchema.parse(JSON.parse(data));
    if ('type' in message) {
      deviceChanges.notify();
      return;
    }
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if ('error' in message) {
      waiting?.reject(new Error(message.error));
    } else {
      waiting?.resolve(message.result);
    }
  });

  return {
    openMicrophone: microphones.open,
    closeMicrophone: microphones.close,
    enumerateDevices: async () => {
      const reply = devicesSchema.parse(await request({ type: 'devices' }));
      return [
        ...toNativeDeviceInfos('audioinput', reply.inputs, reply.defaultInput),
        ...toNativeDeviceInfos(
          'audiooutput',
          reply.outputs,
          reply.defaultOutput,
        ),
      ];
    },
    subscribeDevices: deviceChanges.subscribe,
    checkMicrophoneAccess: async () =>
      accessSchema.parse(await request({ type: 'access' })).granted,
    readOutputVolume: async () =>
      volumeSchema.parse(await request({ type: 'volume' })),
    writeOutputVolume: async (volume) =>
      volumeSchema.parse(await request({ type: 'setVolume', volume })),
    readMicrophoneDenial: (error) =>
      error instanceof Error && error.message === microphoneAccessDenied
        ? 'app'
        : undefined,
    canOpenMicrophoneSettings: (denial) => denial === 'app',
    openMicrophoneSettings: () => {
      void request({ type: 'openSettings' }).catch((error: unknown) => {
        console.error('Failed to open the microphone settings', error);
      });
    },
  };
};
