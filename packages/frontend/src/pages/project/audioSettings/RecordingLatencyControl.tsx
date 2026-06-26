import { Alert, Button, Slider, Stack, Typography } from '@mui/material';
import {
  maximumRecordingLatencyMs,
  minimumRecordingLatencyMs,
} from '@musetric/audio/calibration';
import { type RecordingLatencySource } from '@musetric/engine/state';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const RecordingLatencyControl: FC = () => {
  const { t } = useTranslation();
  const latencySourceLabels: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.latencySource.calibrated'),
    estimated: t('pages.project.audioSettings.latencySource.estimated'),
    manual: t('pages.project.audioSettings.latencySource.manual'),
  };
  const recordingLatencyFrameCount = useEngineStore(
    (state) => state.latencyFrameCount,
  );
  const recordingLatencySource = useEngineStore((state) => state.latencySource);
  const inputLatencyFrameCount = useEngineStore(
    (state) => state.inputLatencyFrameCount,
  );
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const calibrationError = useEngineStore((state) => state.calibrationError);
  const latencyMs = Math.round(
    (recordingLatencyFrameCount / engine.context.sampleRate) * 1000,
  );
  const inputLatencyMs = Math.round(
    (inputLatencyFrameCount / engine.context.sampleRate) * 1000,
  );

  return (
    <>
      <Stack gap={0.5}>
        <Typography variant='body2'>
          {t('pages.project.audioSettings.latency', { value: latencyMs })}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {latencySourceLabels[recordingLatencySource]}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {t('pages.project.audioSettings.inputLatency', {
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
            engine.calibration.setManualLatencyMs(value);
          }}
        />
        <Button
          variant='outlined'
          disabled={recording || calibrating}
          onClick={() => {
            void engine.calibration.calibrate();
          }}
        >
          {calibrating
            ? t('pages.project.audioSettings.calibrating')
            : t('pages.project.audioSettings.calibrate')}
        </Button>
        {calibrationError === 'calibration' && (
          <Alert severity='error'>
            {t('pages.project.audioSettings.calibrationFailed')}
          </Alert>
        )}
      </Stack>
    </>
  );
};
