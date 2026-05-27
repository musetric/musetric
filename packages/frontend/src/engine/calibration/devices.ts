import {
  getRealAudioInputDevices,
  getRealAudioOutputDevices,
  isLikelyMobileUserAgent,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import type { Store } from '../../common/store.js';
import type { EngineAudioOutput } from '../audioOutput/index.js';
import type { EngineState } from '../state.js';

export type CalibrationDevicesOptions = {
  store: Store<EngineState>;
  audioOutput: EngineAudioOutput;
  onDeviceLost: () => void;
  onActiveDeviceChanged: () => void;
};

export type CalibrationDevices = {
  refresh: () => Promise<MediaDeviceInfo[]>;
  start: () => () => void;
};

const enumerateAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

export const createCalibrationDevices = (
  options: CalibrationDevicesOptions,
): CalibrationDevices => {
  const { store, audioOutput, onDeviceLost, onActiveDeviceChanged } = options;
  let initialized = false;
  let previousInputDeviceId: string | undefined = undefined;
  let previousOutputDeviceId: string | undefined = undefined;

  const apply = async (): Promise<MediaDeviceInfo[]> => {
    const devices = await enumerateAudioDevices();
    const state = store.get();
    const realInputDevices = getRealAudioInputDevices(devices);
    const realOutputDevices = getRealAudioOutputDevices(devices);
    const outputSelectionSupported = audioOutput.supportsDeviceSelection;
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
    const nextMicrophoneDeviceId = inputDeviceAvailable
      ? state.microphoneDeviceId
      : undefined;
    const nextOutputDeviceId =
      outputDeviceAvailable && outputSelectionAvailable
        ? state.audioOutputDeviceId
        : undefined;
    const nextInputDevice = resolveAudioInputDevice(devices, {
      explicitDeviceId: nextMicrophoneDeviceId,
      preferBuiltIn: isLikelyMobileUserAgent(navigator.userAgent),
    });
    const nextOutputDevice = resolveAudioOutputDevice(devices, {
      explicitDeviceId: nextOutputDeviceId,
    });
    const activeDeviceChanged =
      initialized &&
      (previousInputDeviceId !== nextInputDevice?.deviceId ||
        previousOutputDeviceId !== nextOutputDevice?.deviceId);

    store.update((draft) => {
      draft.audioDevices = devices;
    });

    if (activeDeviceChanged) {
      onActiveDeviceChanged();
    }

    if (
      !inputDeviceAvailable ||
      !outputDeviceAvailable ||
      !outputSelectionAvailable
    ) {
      if (!outputDeviceAvailable || !outputSelectionAvailable) {
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
        if (!outputDeviceAvailable || !outputSelectionAvailable) {
          draft.audioOutputDeviceId = undefined;
        }
      });
      onDeviceLost();
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
