import {
  createMicrophoneAudioConstraints,
  estimateRecordingLatency,
  getRealAudioInputDevices,
  getRealAudioOutputDevices,
  isLikelyMobileUserAgent,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { type FC, type ReactNode, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import {
  audioSettingsMeterScale,
  getAudioSettingsDevices,
  stopAudioSettingsStream,
} from './audioSettingsDevices.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';
import {
  resetAudioSettingsLatencyEstimate,
  stopActiveAudioSettingsPlayback,
} from './useAudioSettingsActions.js';
import {
  getAudioSettingsOutputSelectionSupported,
  useAudioSettingsResolvedInputDevice,
  useAudioSettingsResolvedOutputDevice,
} from './useAudioSettingsDevices.js';

export type AudioSettingsLifecycleProps = {
  children: ReactNode;
};

export const AudioSettingsLifecycle: FC<AudioSettingsLifecycleProps> = (
  props,
) => {
  const { t } = useTranslation();
  const open = useProjectStore((state) => state.audioSettingsOpen);
  const audioOutputDeviceId = useEngineStore(
    (state) => state.audioOutputDeviceId,
  );
  const resolvedInputDevice = useAudioSettingsResolvedInputDevice();
  const resolvedOutputDevice = useAudioSettingsResolvedOutputDevice();
  const outputSelectionSupported = getAudioSettingsOutputSelectionSupported();
  const setAudioDevices = useAudioSettingsStore(
    (state) => state.setAudioDevices,
  );
  const setLevel = useAudioSettingsStore((state) => state.setLevel);
  const setError = useAudioSettingsStore((state) => state.setError);
  const setLatencyEstimate = useAudioSettingsStore(
    (state) => state.setLatencyEstimate,
  );
  const setPreviewStream = useAudioSettingsStore(
    (state) => state.setPreviewStream,
  );

  const refreshDevices = useCallback(async () => {
    const devices = await getAudioSettingsDevices();
    setAudioDevices(devices);
    return devices;
  }, [setAudioDevices]);

  useEffect(() => {
    let active = true;
    let previousDeviceStateReady = false;
    let previousInputDeviceId: string | undefined = undefined;
    let previousOutputDeviceId: string | undefined = undefined;

    const applyDeviceState = async () => {
      try {
        const devices = await getAudioSettingsDevices();
        if (!active) {
          return;
        }

        setAudioDevices(devices);
        const state = engine.store.get();
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
          previousDeviceStateReady &&
          (previousInputDeviceId !== nextInputDevice?.deviceId ||
            previousOutputDeviceId !== nextOutputDevice?.deviceId);

        if (activeDeviceChanged) {
          await stopActiveAudioSettingsPlayback();
          resetAudioSettingsLatencyEstimate();
        }

        if (
          !inputDeviceAvailable ||
          !outputDeviceAvailable ||
          !outputSelectionAvailable
        ) {
          if (!outputDeviceAvailable || !outputSelectionAvailable) {
            try {
              await engine.audioOutput.setDeviceId(undefined);
            } catch (outputError) {
              console.error('Failed to reset audio output', outputError);
            }
          }
          engine.store.update((draft) => {
            if (!inputDeviceAvailable) {
              draft.microphoneDeviceId = undefined;
            }
            if (!outputDeviceAvailable || !outputSelectionAvailable) {
              draft.audioOutputDeviceId = undefined;
            }
          });
          resetAudioSettingsLatencyEstimate();
        }

        previousDeviceStateReady = true;
        previousInputDeviceId = nextInputDevice?.deviceId;
        previousOutputDeviceId = nextOutputDevice?.deviceId;
      } catch (deviceError) {
        console.error(
          'Failed to refresh audio input and output devices',
          deviceError,
        );
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', applyDeviceState);
    void applyDeviceState();

    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        applyDeviceState,
      );
    };
  }, [outputSelectionSupported, setAudioDevices]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let active = true;
    let stream: MediaStream | undefined = undefined;
    let source: MediaStreamAudioSourceNode | undefined = undefined;
    let analyser: AnalyserNode | undefined = undefined;
    let animationFrame: number | undefined = undefined;

    const updateLevel = () => {
      if (!active || !analyser) {
        return;
      }

      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * audioSettingsMeterScale));
      animationFrame = requestAnimationFrame(updateLevel);
    };

    const startPreview = async () => {
      try {
        setError(undefined);
        setLatencyEstimate(undefined);
        if (engine.context.state === 'suspended') {
          await engine.context.resume();
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: createMicrophoneAudioConstraints({
            deviceId: resolvedInputDevice?.deviceId,
            sampleRate: engine.context.sampleRate,
          }),
        });
        if (!active) {
          stopAudioSettingsStream(stream);
          return;
        }

        setPreviewStream(stream);
        const devices = await getAudioSettingsDevices();
        if (useAudioSettingsStore.getState().previewStream !== stream) {
          return;
        }
        setAudioDevices(devices);
        const expectedInputDevice = resolveAudioInputDevice(devices, {
          explicitDeviceId: engine.store.get().microphoneDeviceId,
          preferBuiltIn: isLikelyMobileUserAgent(navigator.userAgent),
        });
        const [track] = stream.getAudioTracks();
        const currentDeviceId = track.getSettings().deviceId;
        if (
          expectedInputDevice &&
          currentDeviceId &&
          expectedInputDevice.deviceId !== currentDeviceId
        ) {
          setPreviewStream(undefined);
          stopAudioSettingsStream(stream);
          stream = undefined;
          return;
        }
        const estimate = estimateRecordingLatency({
          context: engine.context,
          stream,
          devices,
          outputDeviceId: engine.store.get().audioOutputDeviceId,
        });
        setLatencyEstimate(estimate);
        engine.store.update((state) => {
          if (
            state.recordingLatencySource === 'estimated' ||
            state.recordingLatencyDevicePairKey !== estimate.devicePairKey
          ) {
            state.recordingLatencyFrameCount = estimate.frameCount;
            state.recordingLatencySource = 'estimated';
            state.recordingLatencyDevicePairKey = estimate.devicePairKey;
          }
        });
        analyser = engine.context.createAnalyser();
        analyser.fftSize = 1024;
        source = engine.context.createMediaStreamSource(stream);
        source.connect(analyser);
        updateLevel();
      } catch (previewError) {
        console.error('Failed to open audio settings preview', previewError);
        if (active) {
          setError(t('pages.project.audioSettings.previewError'));
          await refreshDevices();
        }
      }
    };

    void startPreview();

    return () => {
      active = false;
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
      source?.disconnect();
      analyser?.disconnect();
      if (stream) {
        if (useAudioSettingsStore.getState().previewStream === stream) {
          setPreviewStream(undefined);
        }
        stopAudioSettingsStream(stream);
      }
      setLevel(0);
    };
  }, [
    audioOutputDeviceId,
    open,
    refreshDevices,
    resolvedInputDevice?.deviceId,
    resolvedOutputDevice?.deviceId,
    setAudioDevices,
    setError,
    setLatencyEstimate,
    setLevel,
    setPreviewStream,
    t,
  ]);

  return <>{props.children}</>;
};
