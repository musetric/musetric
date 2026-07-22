import {
  getRealAudioInputDevices,
  getRealAudioOutputDevices,
  getRecordingLatencyDevicePairKey,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';

const enumerateAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

type DeviceAvailability = {
  inputDeviceAvailable: boolean;
  outputDeviceAvailable: boolean;
  outputSelectionAvailable: boolean;
};

const getDeviceAvailability = (
  state: EngineState,
  devices: MediaDeviceInfo[],
  outputSelectionSupported: boolean,
): DeviceAvailability => {
  const realInputDevices = getRealAudioInputDevices(devices);
  const realOutputDevices = getRealAudioOutputDevices(devices);
  const inputDeviceAvailable =
    state.microphoneDeviceId === undefined ||
    realInputDevices.some(
      (device) => device.deviceId === state.microphoneDeviceId,
    );
  const outputDeviceAvailable =
    state.audioOutputDeviceId === undefined ||
    realOutputDevices.some(
      (device) => device.deviceId === state.audioOutputDeviceId,
    );
  const outputSelectionAvailable =
    outputSelectionSupported || state.audioOutputDeviceId === undefined;
  return {
    inputDeviceAvailable,
    outputDeviceAvailable,
    outputSelectionAvailable,
  };
};

const resolveNextDevices = (
  state: EngineState,
  devices: MediaDeviceInfo[],
  availability: DeviceAvailability,
) => {
  const nextMicrophoneDeviceId = availability.inputDeviceAvailable
    ? state.microphoneDeviceId
    : undefined;
  const nextOutputDeviceId =
    availability.outputDeviceAvailable && availability.outputSelectionAvailable
      ? state.audioOutputDeviceId
      : undefined;
  const nextInputDevice = resolveAudioInputDevice(devices, {
    explicitDeviceId: nextMicrophoneDeviceId,
    preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
  });
  const nextOutputDevice = resolveAudioOutputDevice(devices, {
    explicitDeviceId: nextOutputDeviceId,
  });
  return { nextInputDevice, nextOutputDevice };
};

const resetLostDevices = async (
  audioOutput: EngineAudioOutput,
  store: Store<EngineState>,
  availability: DeviceAvailability,
): Promise<void> => {
  const {
    inputDeviceAvailable,
    outputDeviceAvailable,
    outputSelectionAvailable,
  } = availability;
  const resetOutput = !outputDeviceAvailable || !outputSelectionAvailable;
  if (resetOutput) {
    try {
      await audioOutput.setDeviceId(undefined);
    } catch (outputError) {
      console.error('Failed to reset audio output', outputError);
    }
  }
  store.update((draft) => {
    if (!inputDeviceAvailable) {
      draft.microphoneDeviceId = undefined;
    }
    if (resetOutput) {
      draft.audioOutputDeviceId = undefined;
    }
  });
};

export type CalibrationDevicesOptions = {
  store: Store<EngineState>;
  audioOutput: EngineAudioOutput;
  onInitialDevicePair: (devicePairKey: string) => void;
  onDeviceLost: (devicePairKey: string) => void;
  onActiveDeviceChanged: (devicePairKey: string) => void;
};

export type CalibrationDevices = {
  refresh: () => Promise<MediaDeviceInfo[]>;
  start: () => () => void;
};

export const createCalibrationDevices = (
  options: CalibrationDevicesOptions,
): CalibrationDevices => {
  const {
    store,
    audioOutput,
    onInitialDevicePair,
    onDeviceLost,
    onActiveDeviceChanged,
  } = options;
  let initialized = false;
  let previousInputDeviceId: string | undefined = undefined;
  let previousOutputDeviceId: string | undefined = undefined;

  const apply = async (): Promise<MediaDeviceInfo[]> => {
    const devices = await enumerateAudioDevices();
    const state = store.get();
    const availability = getDeviceAvailability(
      state,
      devices,
      audioOutput.supportsDeviceSelection,
    );
    const { nextInputDevice, nextOutputDevice } = resolveNextDevices(
      state,
      devices,
      availability,
    );
    const nextDevicePairKey = getRecordingLatencyDevicePairKey(
      nextInputDevice,
      nextOutputDevice,
    );
    const isInitial = !initialized;
    const activeDeviceChanged =
      initialized &&
      (previousInputDeviceId !== nextInputDevice?.deviceId ||
        previousOutputDeviceId !== nextOutputDevice?.deviceId);

    store.update((draft) => {
      draft.audioDevices = devices;
    });

    if (isInitial) {
      onInitialDevicePair(nextDevicePairKey);
    }

    if (activeDeviceChanged) {
      onActiveDeviceChanged(nextDevicePairKey);
    }

    const deviceLost =
      !availability.inputDeviceAvailable ||
      !availability.outputDeviceAvailable ||
      !availability.outputSelectionAvailable;
    if (deviceLost) {
      await resetLostDevices(audioOutput, store, availability);
      onDeviceLost(nextDevicePairKey);
    }

    initialized = true;
    previousInputDeviceId = nextInputDevice?.deviceId;
    previousOutputDeviceId = nextOutputDevice?.deviceId;
    return devices;
  };

  return {
    refresh: async () => {
      try {
        return await apply();
      } catch (error) {
        console.error('Failed to enumerate audio devices', error);
        return store.get().audioDevices;
      }
    },
    start: () => {
      const listener = () => {
        void apply().catch((error: unknown) => {
          console.error('Failed to refresh audio devices', error);
        });
      };
      navigator.mediaDevices.addEventListener('devicechange', listener);
      void apply().catch((error: unknown) => {
        console.error('Failed to refresh audio devices', error);
      });
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', listener);
      };
    },
  };
};
