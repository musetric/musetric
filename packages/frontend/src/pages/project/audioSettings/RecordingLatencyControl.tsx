import { Button, Slider, Stack, Typography } from '@mui/material';
import {
  maximumRecordingLatencyMs,
  minimumRecordingLatencyMs,
} from '@musetric/audio/recording';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { type RecordingLatencySource } from '../../../engine/state.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';
import { useCalibrateRecordingLatency } from './useAudioSettingsActions.js';
import { useAudioSettingsInputLatencyMs } from './useAudioSettingsDevices.js';

export const RecordingLatencyControl: FC = () => {
  const { t } = useTranslation();
  const latencySourceLabels: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.latencySource.calibrated'),
    estimated: t('pages.project.audioSettings.latencySource.estimated'),
    manual: t('pages.project.audioSettings.latencySource.manual'),
  };
  const recordingLatencyFrameCount = useEngineStore(
    (state) => state.recordingLatencyFrameCount,
  );
  const recordingLatencySource = useEngineStore(
    (state) => state.recordingLatencySource,
  );
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useAudioSettingsStore((state) => state.calibrating);
  const latencyEstimate = useAudioSettingsStore(
    (state) => state.latencyEstimate,
  );
  const inputLatencyMs = useAudioSettingsInputLatencyMs();
  const calibrate = useCalibrateRecordingLatency();
  const latencyMs = Math.round(
    (recordingLatencyFrameCount / engine.context.sampleRate) * 1000,
  );

  return (
    <>
      <Stack gap={0.5}>
        <Typography variant='body2'>
          {t('pages.project.audioSettings.latency', {
            value: latencyMs,
          })}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {latencySourceLabels[recordingLatencySource]}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {inputLatencyMs === undefined
            ? t('pages.project.audioSettings.inputLatencyUnknown')
            : t('pages.project.audioSettings.inputLatency', {
                value: inputLatencyMs,
              })}
        </Typography>
        {recording && (
          <Typography variant='caption' color='text.secondary'>
            {t('pages.project.audioSettings.deviceLocked')}
          </Typography>
        )}
      </Stack>
      <Stack gap={1}>
        <Slider
          min={minimumRecordingLatencyMs}
          max={maximumRecordingLatencyMs}
          step={10}
          value={latencyMs}
          onChange={(_, value) => {
            if (Array.isArray(value)) {
              return;
            }
            engine.store.update((state) => {
              state.recordingLatencyFrameCount = Math.round(
                (value / 1000) * engine.context.sampleRate,
              );
              state.recordingLatencySource = 'manual';
              state.recordingLatencyDevicePairKey =
                latencyEstimate?.devicePairKey;
            });
          }}
        />
        <Button
          variant='outlined'
          disabled={recording || calibrating}
          onClick={() => {
            void calibrate();
          }}
        >
          {calibrating
            ? t('pages.project.audioSettings.calibrating')
            : t('pages.project.audioSettings.calibrate')}
        </Button>
      </Stack>
    </>
  );
};
