import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { runRecordingLatencyCalibration } from '../../../engine/recordingLatencyCalibration.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';
import { useAudioSettingsResolvedInputDevice } from './useAudioSettingsDevices.js';

export const resetAudioSettingsLatencyEstimate = () => {
  engine.store.update((state) => {
    state.recordingLatencySource = 'estimated';
    state.recordingLatencyDevicePairKey = undefined;
  });
};

export const stopActiveAudioSettingsPlayback = async () => {
  if (engine.store.get().playing) {
    await engine.player.stop();
  }
};

export const useSelectAudioInputDevice = () => {
  const setError = useAudioSettingsStore((state) => state.setError);

  return useCallback(
    async (deviceId: string) => {
      if (!deviceId) {
        return;
      }

      setError(undefined);
      await stopActiveAudioSettingsPlayback();
      engine.store.update((state) => {
        state.microphoneDeviceId = deviceId;
      });
      resetAudioSettingsLatencyEstimate();
    },
    [setError],
  );
};

export const useSelectAudioOutputDevice = () => {
  const { t } = useTranslation();
  const setError = useAudioSettingsStore((state) => state.setError);

  return useCallback(
    async (deviceId: string) => {
      if (!deviceId) {
        return;
      }

      setError(undefined);
      await stopActiveAudioSettingsPlayback();
      try {
        await engine.audioOutput.setDeviceId(deviceId);
        engine.store.update((state) => {
          state.audioOutputDeviceId = deviceId;
        });
        resetAudioSettingsLatencyEstimate();
      } catch (outputError) {
        console.error('Failed to select audio output', outputError);
        setError(t('pages.project.audioSettings.outputError'));
      }
    },
    [setError, t],
  );
};

export const useCalibrateRecordingLatency = () => {
  const { t } = useTranslation();
  const resolvedInputDevice = useAudioSettingsResolvedInputDevice();
  const setCalibrating = useAudioSettingsStore((state) => state.setCalibrating);
  const setError = useAudioSettingsStore((state) => state.setError);

  return useCallback(async () => {
    try {
      const currentState = useAudioSettingsStore.getState();
      const currentEstimate = currentState.latencyEstimate;
      if (!currentEstimate) {
        setError(t('pages.project.audioSettings.calibrationFailed'));
        return;
      }

      setCalibrating(true);
      setError(undefined);
      if (engine.context.state === 'suspended') {
        await engine.context.resume();
      }
      const calibrationResult = await runRecordingLatencyCalibration({
        context: engine.context,
        outputNode: engine.audioOutput.outputNode,
        playOutput: engine.audioOutput.play,
        deviceId: resolvedInputDevice?.deviceId,
        stream: currentState.previewStream,
      });
      if (!calibrationResult) {
        setError(t('pages.project.audioSettings.calibrationFailed'));
        return;
      }

      console.info(
        'Recording latency calibration samples',
        calibrationResult.measuredLatencyFrameCounts.map((frameCount) =>
          Math.round((frameCount / engine.context.sampleRate) * 1000),
        ),
      );
      engine.store.update((state) => {
        state.recordingLatencyFrameCount = calibrationResult.latencyFrameCount;
        state.recordingLatencySource = 'calibrated';
        state.recordingLatencyDevicePairKey = currentEstimate.devicePairKey;
      });
    } catch (calibrationError) {
      console.error('Failed to calibrate recording latency', calibrationError);
      setError(t('pages.project.audioSettings.calibrationFailed'));
    } finally {
      setCalibrating(false);
    }
  }, [resolvedInputDevice?.deviceId, setCalibrating, setError, t]);
};
