import { z } from 'zod';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineMicrophone,
  type EngineMicrophoneRequest,
} from './engineAudioSession.js';
import { decodeNativeChunk } from './nativeChunk.js';
import { type CapturedChunk } from './timedChunkPusher.cross.js';
import {
  type CapturedChunkListener,
  createTimedMicrophones,
  type TimedMicrophoneSource,
} from './timedMicrophone.js';

const deviceChangeDelayMs = 500;

export const nativePortSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const nativeStartSchema = z.object({
  session: z.number(),
  deviceId: z.string(),
  chunkSeconds: z.number(),
});

export type NativePort = z.infer<typeof nativePortSchema> & {
  groupId?: string;
};

const toDeviceInfo = (
  kind: MediaDeviceKind,
  port: NativePort,
  deviceId = port.id,
): MediaDeviceInfo => {
  const info = {
    deviceId,
    groupId: port.groupId ?? `${kind}-${port.id}`,
    kind,
    label: port.label,
  };
  return { ...info, toJSON: () => info };
};

export const toNativeDeviceInfos = (
  kind: MediaDeviceKind,
  ports: NativePort[],
  defaultId: string | undefined,
) => {
  const defaultPort = ports.find((port) => port.id === defaultId);
  return [
    ...(defaultPort ? [toDeviceInfo(kind, defaultPort, 'default')] : []),
    ...ports.map((port) => toDeviceInfo(kind, port)),
  ];
};

export const createNativeDeviceChanges = () => {
  const listeners = new Set<() => void>();
  let timeout: number | undefined = undefined;
  return {
    notify: () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        for (const listener of listeners) {
          listener();
        }
      }, deviceChangeDelayMs);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type NativeCaptureRequest = {
  deviceId?: string;
  sampleRate: number;
};

type NativeStart = z.infer<typeof nativeStartSchema>;

export type NativeCapture = {
  readClockOffset: () => number | Promise<number>;
  start: (
    request: NativeCaptureRequest,
    receive: (buffer: ArrayBuffer) => void,
  ) => Promise<NativeStart>;
  stop: () => Promise<unknown>;
};

export type NativeMicrophones = {
  open: (request: EngineMicrophoneRequest) => Promise<EngineMicrophone>;
  close: (microphone: EngineMicrophone) => void;
  receive: (buffer: ArrayBuffer) => void;
};

export type CreateNativeMicrophonesOptions = {
  getContext: () => AudioContext;
  outputClock: EngineOutputClock;
  onCaptured: CapturedChunkListener;
  capture: NativeCapture;
};

export const createNativeMicrophones = (
  options: CreateNativeMicrophonesOptions,
): NativeMicrophones => {
  const { getContext, outputClock, onCaptured, capture } = options;
  const consumers = new Set<(chunk: CapturedChunk) => void>();
  const sources = new Map<EngineMicrophone, TimedMicrophoneSource>();
  const timedMicrophones = createTimedMicrophones(
    getContext,
    outputClock,
    onCaptured,
  );
  let session: number | undefined = undefined;
  let opening = 0;
  let clockOffsetMs = 0;

  const receive = (buffer: ArrayBuffer) => {
    const decoded = decodeNativeChunk(buffer, clockOffsetMs);
    if (decoded.session !== session) {
      return;
    }
    for (const consumer of consumers) {
      consumer({ ...decoded.chunk, samples: decoded.chunk.samples.slice() });
    }
  };

  const stopCapture = () => {
    if (sources.size > 0 || opening > 0) {
      return;
    }
    session = undefined;
    void capture.stop().catch((error: unknown) => {
      console.error('Failed to stop the native microphone', error);
    });
  };

  stopCapture();

  return {
    open: async (request) => {
      opening += 1;
      const context = getContext();
      try {
        clockOffsetMs = await capture.readClockOffset();
        const reply = await capture.start(
          { deviceId: request.deviceId, sampleRate: context.sampleRate },
          receive,
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
    close: (microphone) => {
      const timed = sources.get(microphone);
      if (!timed) {
        return;
      }
      sources.delete(microphone);
      timed.close();
      stopCapture();
    },
    receive,
  };
};
