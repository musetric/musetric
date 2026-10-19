import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import {
  Box,
  Button,
  Collapse,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import {
  maximumRecordingLatencyMs,
  minimumRecordingLatencyMs,
} from '@musetric/audio/calibration';
import {
  getInputShareFrameCount,
  getOutputLatencyFrameCount,
  getRecordingLatencyFrameCount,
  type RecordingLatencySource,
} from '@musetric/engine';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

export const RecordingLatencyControl: FC = () => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const setCalibrationPrompt = useProjectStore(
    (state) => state.setCalibrationPrompt,
  );
  const latencySourceLabels: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.latencySource.calibrated'),
    estimated: t('pages.project.audioSettings.latencySource.estimated'),
    manual: t('pages.project.audioSettings.latencySource.manual'),
  };
  const recordingLatencyFrameCount = useEngineStore(
    getRecordingLatencyFrameCount,
  );
  const outputLatencyFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const recordingLatencySource = useEngineStore((state) => state.latencySource);
  const inputLatencyFrameCount = useEngineStore(getInputShareFrameCount);
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const { sampleRate } = engine.context;
  const latencyMs = Math.round(
    (recordingLatencyFrameCount / sampleRate) * 1000,
  );
  const inputLatencyMs = Math.round(
    (inputLatencyFrameCount / sampleRate) * 1000,
  );
  const outputLatencyMs = Math.round(
    (outputLatencyFrameCount / sampleRate) * 1000,
  );
  const outputSeconds = (outputLatencyFrameCount / sampleRate).toFixed(2);
  const statusTitles: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.timing.calibrated'),
    estimated: t('pages.project.audioSettings.timing.needed'),
    manual: t('pages.project.audioSettings.timing.manual'),
  };
  const statusHints: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.timing.calibratedHint', {
      seconds: outputSeconds,
    }),
    estimated: t('pages.project.audioSettings.timing.neededHint'),
    manual: t('pages.project.audioSettings.timing.manualHint'),
  };

  return (
    <Stack
      component='section'
      aria-label={t('pages.project.audioSettings.timing.title')}
      sx={{ gap: 2.5, p: 3.5, borderRadius: 2.5, bgcolor: 'action.hover' }}
    >
      <Typography variant='body2' sx={{ fontWeight: 500 }}>
        {t('pages.project.audioSettings.timing.title')}
      </Typography>
      <Stack direction='row' sx={{ gap: 2.5, alignItems: 'flex-start' }}>
        {recordingLatencySource === 'calibrated' ? (
          <CheckRoundedIcon
            sx={{ fontSize: 18, mt: 0.25, color: 'primary.main', flex: 'none' }}
          />
        ) : (
          <Box
            sx={{
              width: 10,
              height: 10,
              mt: 1.25,
              flex: 'none',
              borderRadius: '50%',
              bgcolor:
                recordingLatencySource === 'estimated'
                  ? 'warning.main'
                  : 'text.secondary',
            }}
          />
        )}
        <Stack sx={{ gap: 0.5 }}>
          <Typography variant='body2'>
            {statusTitles[recordingLatencySource]}
          </Typography>
          <Typography variant='caption' sx={{ color: 'text.secondary' }}>
            {statusHints[recordingLatencySource]}
          </Typography>
        </Stack>
      </Stack>
      <Button
        variant='outlined'
        disabled={recording || calibrating}
        onClick={() => {
          setCalibrationPrompt('settings');
        }}
      >
        {recordingLatencySource === 'estimated'
          ? t('pages.project.audioSettings.calibrate')
          : t('pages.project.calibration.again')}
      </Button>
      <Button
        aria-expanded={detailsOpen}
        onClick={() => {
          setDetailsOpen(!detailsOpen);
        }}
        startIcon={
          <ChevronRightRoundedIcon
            sx={{
              transform: detailsOpen ? 'rotate(90deg)' : undefined,
              transition: 'transform 150ms',
            }}
          />
        }
        sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}
      >
        {t('pages.project.audioSettings.timing.details')}
      </Button>
      <Collapse in={detailsOpen}>
        <Stack sx={{ gap: 2, pl: 5.5 }}>
          <Stack sx={{ gap: 0.5 }}>
            <Typography variant='body2'>
              {t('pages.project.audioSettings.latency', { value: latencyMs })}
            </Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {latencySourceLabels[recordingLatencySource]}
            </Typography>
          </Stack>
          <Typography variant='caption' sx={{ color: 'text.secondary' }}>
            {t('pages.project.audioSettings.outputLatency', {
              value: outputLatencyMs,
            })}
          </Typography>
          <Typography variant='caption' sx={{ color: 'text.secondary' }}>
            {t('pages.project.audioSettings.inputLatency', {
              value: inputLatencyMs,
            })}
          </Typography>
          {recording && (
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {t('pages.project.audioSettings.deviceLocked')}
            </Typography>
          )}
          <Typography
            id='recording-latency-offset'
            variant='caption'
            sx={{ color: 'text.secondary' }}
          >
            {t('pages.project.audioSettings.timing.offset')}
          </Typography>
          <Slider
            aria-labelledby='recording-latency-offset'
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
        </Stack>
      </Collapse>
    </Stack>
  );
};
