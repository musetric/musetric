import {
  getRealAudioInputDevices,
  getRealAudioOutputDevices,
  isLikelyMobileUserAgent,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { useMemo } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';

export const useAudioSettingsInputDevices = () => {
  const audioDevices = useAudioSettingsStore((state) => state.audioDevices);

  return useMemo(() => getRealAudioInputDevices(audioDevices), [audioDevices]);
};

export const useAudioSettingsOutputDevices = () => {
  const audioDevices = useAudioSettingsStore((state) => state.audioDevices);

  return useMemo(() => getRealAudioOutputDevices(audioDevices), [audioDevices]);
};

export const useAudioSettingsResolvedInputDevice = () => {
  const audioDevices = useAudioSettingsStore((state) => state.audioDevices);
  const microphoneDeviceId = useEngineStore(
    (state) => state.microphoneDeviceId,
  );
  const preferBuiltInInput = isLikelyMobileUserAgent(navigator.userAgent);

  return useMemo(
    () =>
      resolveAudioInputDevice(audioDevices, {
        explicitDeviceId: microphoneDeviceId,
        preferBuiltIn: preferBuiltInInput,
      }),
    [audioDevices, microphoneDeviceId, preferBuiltInInput],
  );
};

export const useAudioSettingsResolvedOutputDevice = () => {
  const audioDevices = useAudioSettingsStore((state) => state.audioDevices);
  const audioOutputDeviceId = useEngineStore(
    (state) => state.audioOutputDeviceId,
  );

  return useMemo(
    () =>
      resolveAudioOutputDevice(audioDevices, {
        explicitDeviceId: audioOutputDeviceId,
      }),
    [audioDevices, audioOutputDeviceId],
  );
};

export const useAudioSettingsInputSelectValue = () => {
  const resolvedInputDevice = useAudioSettingsResolvedInputDevice();

  return resolvedInputDevice?.deviceId ?? '';
};

export const useAudioSettingsOutputSelectValue = () => {
  const resolvedOutputDevice = useAudioSettingsResolvedOutputDevice();

  return resolvedOutputDevice?.deviceId ?? '';
};

export const useAudioSettingsInputLatencyMs = () => {
  const latencyEstimate = useAudioSettingsStore(
    (state) => state.latencyEstimate,
  );

  return latencyEstimate === undefined
    ? undefined
    : Math.round(
        (latencyEstimate.inputLatencyFrameCount / engine.context.sampleRate) *
          1000,
      );
};

export const getAudioSettingsOutputSelectionSupported = () =>
  engine.audioOutput.supportsDeviceSelection;
