import { z } from 'zod';
import {
  type EngineAudioSession,
  type EngineMicrophone,
  setAudioSessionType,
} from './engineAudioSession.js';
import nativeMicrophoneWorkletUrl from './nativeMicrophone.worklet.ts?worker&url';
import {
  nativeMicrophoneChannel,
  nativeMicrophoneDelaySeconds,
  nativeMicrophoneProcessorName,
} from './protocol.cross.js';

const deviceChangeDelayMs = 500;
const readyTimeoutMs = 2000;
const bluetoothPortTypes = [
  'BluetoothA2DPOutput',
  'BluetoothHFP',
  'BluetoothLE',
];

const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

const devicesSchema = z.object({
  inputs: z.array(portSchema),
  outputs: z.array(portSchema),
});

const captureSchema = z.object({
  deviceId: z.string(),
  inputLatency: z.number(),
  outputLatency: z.number(),
});

type NativeMicrophoneCommand =
  | { type: 'devices' }
  | { type: 'start'; deviceId?: string; sampleRate: number }
  | { type: 'stop' };

export type NativeMicrophoneHandler = {
  postMessage: (command: NativeMicrophoneCommand) => Promise<unknown>;
};

type NativeMicrophoneReceiver = {
  receive: (session: number, frame: number, samples: string) => void;
  devicechange: () => void;
};

type NativeMicrophoneWindow = Window & {
  webkit?: {
    messageHandlers?: { musetricMicrophone?: NativeMicrophoneHandler };
  };
  musetricMicrophone?: NativeMicrophoneReceiver;
};

const readWindow = (): NativeMicrophoneWindow => window;

export const readNativeMicrophoneHandler = ():
  NativeMicrophoneHandler | undefined =>
  readWindow().webkit?.messageHandlers?.musetricMicrophone;

type NativePort = z.infer<typeof portSchema>;

const toDeviceInfo = (
  kind: MediaDeviceKind,
  port: NativePort,
): MediaDeviceInfo => {
  const info = {
    deviceId: port.id,
    groupId: port.type,
    kind,
    label: bluetoothPortTypes.includes(port.type)
      ? `${port.name} (Bluetooth)`
      : port.name,
  };
  return { ...info, toJSON: () => info };
};

const decodeSamples = (encoded: string) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Float32Array(bytes.buffer);
};

type NativeCapture = {
  node: AudioWorkletNode;
  keepAlive: GainNode;
  port: ReturnType<typeof nativeMicrophoneChannel.outbound<MessagePort>>;
  ready: Promise<void>;
};

export const createNativeAudioSession = (
  context: AudioContext,
  handler: NativeMicrophoneHandler,
): EngineAudioSession => {
  const listeners = new Set<() => void>();
  const sources = new Map<EngineMicrophone, AudioNode[]>();
  let capture: NativeCapture | undefined = undefined;
  let modulePromise: Promise<void> | undefined = undefined;
  let opening = 0;
  let currentSession = -1;
  let minimumSession = 0;
  let deviceChangeTimeout: number | undefined = undefined;

  setAudioSessionType('playback');

  readWindow().musetricMicrophone = {
    receive: (session, frame, samples) => {
      if (!capture || session < minimumSession) {
        return;
      }
      if (session !== currentSession) {
        currentSession = session;
        capture.port.methods.reset();
      }
      capture.port.methods.push({ frame, samples: decodeSamples(samples) });
    },
    devicechange: () => {
      window.clearTimeout(deviceChangeTimeout);
      deviceChangeTimeout = window.setTimeout(() => {
        for (const listener of listeners) {
          listener();
        }
      }, deviceChangeDelayMs);
    },
  };

  const loadModule = async () => {
    modulePromise ??= context.audioWorklet
      .addModule(nativeMicrophoneWorkletUrl)
      .catch((error: unknown) => {
        modulePromise = undefined;
        throw error;
      });
    await modulePromise;
  };

  const createCapture = (): NativeCapture => {
    const node = new AudioWorkletNode(context, nativeMicrophoneProcessorName, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const keepAlive = context.createGain();
    keepAlive.gain.value = 0;
    node.connect(keepAlive);
    keepAlive.connect(context.destination);
    const port = nativeMicrophoneChannel.outbound(node.port);
    const ready = new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, readyTimeoutMs);
      port.bindHandlers({
        ready: () => {
          window.clearTimeout(timeout);
          resolve();
        },
      });
    });
    return { node, keepAlive, port, ready };
  };

  const stopCapture = () => {
    if (sources.size > 0 || opening > 0) {
      return;
    }
    minimumSession = currentSession + 1;
    if (capture) {
      capture.node.disconnect();
      capture.keepAlive.disconnect();
      capture.node.port.close();
      capture = undefined;
    }
    void handler.postMessage({ type: 'stop' }).catch((error: unknown) => {
      console.error('Failed to stop the native microphone', error);
    });
  };

  return {
    openMicrophone: async (request) => {
      const { deviceId } = request;
      opening += 1;
      try {
        await loadModule();
        const reply = captureSchema.parse(
          await handler.postMessage({
            type: 'start',
            deviceId,
            sampleRate: context.sampleRate,
          }),
        );
        capture ??= createCapture();
        const { node, ready } = capture;
        await ready;
        const settings = {
          deviceId: reply.deviceId,
          latency: reply.inputLatency + nativeMicrophoneDelaySeconds,
        };
        const created: AudioNode[] = [];
        const microphone: EngineMicrophone = {
          getSettings: () => settings,
          getMeasuredInputLatency: () => undefined,
          outputLatency: reply.outputLatency,
          createSource: () => {
            const source = context.createGain();
            node.connect(source);
            created.push(source);
            return source;
          },
        };
        sources.set(microphone, created);
        return microphone;
      } finally {
        opening -= 1;
        stopCapture();
      }
    },
    closeMicrophone: (microphone) => {
      const created = sources.get(microphone);
      if (!created) {
        return;
      }
      sources.delete(microphone);
      for (const source of created) {
        capture?.node.disconnect(source);
      }
      stopCapture();
    },
    enumerateDevices: async () => {
      const reply = devicesSchema.parse(
        await handler.postMessage({ type: 'devices' }),
      );
      return [
        ...reply.inputs.map((port) => toDeviceInfo('audioinput', port)),
        ...reply.outputs.map((port) => toDeviceInfo('audiooutput', port)),
      ];
    },
    subscribeDevices: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
