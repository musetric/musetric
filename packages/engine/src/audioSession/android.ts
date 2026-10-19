import { z } from 'zod';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
  microphoneAccessDenied,
} from './engineAudioSession.js';
import { type CapturedChunk } from './timedChunkPusher.cross.js';
import {
  type CapturedChunkListener,
  createTimedMicrophones,
  type TimedMicrophoneSource,
} from './timedMicrophone.js';

const deviceChangeDelayMs = 500;
const clockProbeCount = 9;
const headerValueCount = 4;
const headerBytes = headerValueCount * Float64Array.BYTES_PER_ELEMENT;

const portSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const devicesSchema = z.object({
  inputs: z.array(portSchema),
  outputs: z.array(portSchema),
  defaultInput: z.string().optional(),
  defaultOutput: z.string().optional(),
});

const startSchema = z.object({
  session: z.number(),
  deviceId: z.string(),
  chunkSeconds: z.number(),
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

type AndroidPort = z.infer<typeof portSchema>;

const toDeviceInfo = (
  kind: MediaDeviceKind,
  port: AndroidPort,
  deviceId = port.id,
): MediaDeviceInfo => {
  const info = {
    deviceId,
    groupId: `${kind}-${port.id}`,
    kind,
    label: port.label,
  };
  return { ...info, toJSON: () => info };
};

const toDeviceInfos = (
  kind: MediaDeviceKind,
  ports: AndroidPort[],
  defaultId: string | undefined,
) => {
  const defaultPort = ports.find((port) => port.id === defaultId);
  return [
    ...(defaultPort ? [toDeviceInfo(kind, defaultPort, 'default')] : []),
    ...ports.map((port) => toDeviceInfo(kind, port)),
  ];
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
  | { type: 'start'; deviceId?: string; sampleRate: number }
  | { type: 'stop' }
  | { type: 'openSettings' };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export const createAndroidAudioSession = (
  context: AudioContext,
  outputClock: EngineOutputClock,
  android: AndroidMicrophone,
  onCaptured: CapturedChunkListener,
): EngineAudioSession => {
  const { bridge, clock } = android;
  const listeners = new Set<() => void>();
  const pending = new Map<number, PendingRequest>();
  const consumers = new Set<(chunk: CapturedChunk) => void>();
  const sources = new Map<EngineMicrophone, TimedMicrophoneSource>();
  const timedMicrophones = createTimedMicrophones(
    context,
    outputClock,
    onCaptured,
  );
  let nextRequestId = 0;
  let session: number | undefined = undefined;
  let opening = 0;
  let clockOffsetMs = measureClockOffset(clock);
  let deviceChangeTimeout: number | undefined = undefined;

  const request = async (command: AndroidMicrophoneCommand) =>
    new Promise<unknown>((resolve, reject) => {
      nextRequestId += 1;
      pending.set(nextRequestId, { resolve, reject });
      bridge.postMessage(JSON.stringify({ ...command, id: nextRequestId }));
    });

  const receiveChunk = (buffer: ArrayBuffer) => {
    const [chunkSession, captureMs, sampleRate, frame] = new Float64Array(
      buffer,
      0,
      headerValueCount,
    );
    if (chunkSession !== session) {
      return;
    }
    const samples = new Float32Array(buffer, headerBytes);
    for (const consumer of consumers) {
      consumer({
        startMs: captureMs - clockOffsetMs,
        frame,
        sampleRate,
        samples: samples.slice(),
      });
    }
  };

  const notifyDeviceChange = () => {
    window.clearTimeout(deviceChangeTimeout);
    deviceChangeTimeout = window.setTimeout(() => {
      for (const listener of listeners) {
        listener();
      }
    }, deviceChangeDelayMs);
  };

  bridge.addEventListener('message', (event) => {
    const { data } = event;
    if (data instanceof ArrayBuffer) {
      receiveChunk(data);
      return;
    }
    if (typeof data !== 'string') {
      return;
    }
    const message = messageSchema.parse(JSON.parse(data));
    if ('type' in message) {
      notifyDeviceChange();
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

  const stopCapture = () => {
    if (sources.size > 0 || opening > 0) {
      return;
    }
    session = undefined;
    void request({ type: 'stop' }).catch((error: unknown) => {
      console.error('Failed to stop the native microphone', error);
    });
  };

  stopCapture();

  return {
    openMicrophone: async (microphoneRequest) => {
      opening += 1;
      try {
        clockOffsetMs = measureClockOffset(clock);
        const reply = startSchema.parse(
          await request({
            type: 'start',
            deviceId: microphoneRequest.deviceId,
            sampleRate: context.sampleRate,
          }),
        );
        session = reply.session;
        const timed = await timedMicrophones.open((push) => {
          consumers.add(push);
          return () => {
            consumers.delete(push);
          };
        });
        const settings = {
          deviceId: reply.deviceId,
          latency: reply.chunkSeconds,
        };
        const microphone: EngineMicrophone = {
          getSettings: () => settings,
          getMeasuredInputLatency: () => undefined,
          whenInputLatencyMeasured: async () => Promise.resolve(),
          exactRoundTripLatency: timed.roundTripLatency,
          createSource: () => {
            const source = context.createGain();
            timed.node.connect(source);
            return source;
          },
        };
        sources.set(microphone, timed);
        return microphone;
      } finally {
        opening -= 1;
        stopCapture();
      }
    },
    closeMicrophone: (microphone) => {
      const timed = sources.get(microphone);
      if (!timed) {
        return;
      }
      sources.delete(microphone);
      timed.close();
      stopCapture();
    },
    enumerateDevices: async () => {
      const reply = devicesSchema.parse(await request({ type: 'devices' }));
      return [
        ...toDeviceInfos('audioinput', reply.inputs, reply.defaultInput),
        ...toDeviceInfos('audiooutput', reply.outputs, reply.defaultOutput),
      ];
    },
    subscribeDevices: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
