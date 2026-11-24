import {
  Channel,
  invoke,
  type InvokeArgs,
  isTauri,
} from '@tauri-apps/api/core';
import { z } from 'zod';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  microphoneAccessDenied,
} from './engineAudioSession.js';
import {
  createNativeDeviceChanges,
  createNativeMicrophones,
  nativePortSchema,
  nativeStartSchema,
  toNativeDeviceInfos,
} from './nativeCapture.js';
import {
  canOpenWebMicrophoneSettings,
  openWebMicrophoneSettings,
} from './settings.js';
import { type CapturedChunkListener } from './timedMicrophone.js';

const nativeMicrophone = import.meta.env.frontendNativeMicrophone === 'true';
const clockProbeCount = 9;

const devicesSchema = z.object({
  inputs: z.array(nativePortSchema),
  defaultInput: z.string().optional(),
});

const clockSchema = z.number();

type DesktopMicrophoneCommand =
  'clock' | 'devices' | 'start' | 'stop' | 'watch';

const request = async (command: DesktopMicrophoneCommand, args?: InvokeArgs) =>
  invoke<unknown>(`plugin:microphone|${command}`, args).catch(
    (error: unknown) => {
      throw typeof error === 'string' ? new Error(error) : error;
    },
  );

export const hasDesktopMicrophone = () => nativeMicrophone && isTauri();

const measureClockOffset = async () => {
  let bestSpan = Infinity;
  let offset = 0;
  for (let index = 0; index < clockProbeCount; index += 1) {
    const before = performance.now();
    const native = clockSchema.parse(await request('clock'));
    const after = performance.now();
    if (after - before < bestSpan) {
      bestSpan = after - before;
      offset = native - (before + after) / 2;
    }
  }
  return offset;
};

export const createDesktopAudioSession = (
  getContext: () => AudioContext,
  outputClock: EngineOutputClock,
  onCaptured: CapturedChunkListener,
): EngineAudioSession => {
  const deviceChanges = createNativeDeviceChanges();
  const microphones = createNativeMicrophones({
    getContext,
    outputClock,
    onCaptured,
    capture: {
      readClockOffset: measureClockOffset,
      start: async (captureRequest, receive) =>
        nativeStartSchema.parse(
          await request('start', {
            ...captureRequest,
            onChunk: new Channel<ArrayBuffer>(receive),
          }),
        ),
      stop: async () => request('stop'),
    },
  });

  void request('watch', {
    onChange: new Channel<null>(deviceChanges.notify),
  }).catch((error: unknown) => {
    console.error('Failed to watch the microphones', error);
  });
  navigator.mediaDevices.addEventListener('devicechange', deviceChanges.notify);

  return {
    openMicrophone: microphones.open,
    closeMicrophone: microphones.close,
    enumerateDevices: async () => {
      const [reply, devices] = await Promise.all([
        request('devices'),
        navigator.mediaDevices.enumerateDevices(),
      ]);
      const { inputs, defaultInput } = devicesSchema.parse(reply);
      return [
        ...toNativeDeviceInfos('audioinput', inputs, defaultInput),
        ...devices.filter((device) => device.kind === 'audiooutput'),
      ];
    },
    subscribeDevices: deviceChanges.subscribe,
    readMicrophoneDenial: (error) =>
      error instanceof Error && error.message === microphoneAccessDenied
        ? 'system'
        : undefined,
    canOpenMicrophoneSettings: canOpenWebMicrophoneSettings,
    openMicrophoneSettings: openWebMicrophoneSettings,
  };
};
