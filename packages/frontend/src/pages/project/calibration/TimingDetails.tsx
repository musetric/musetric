import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { Button, Popover, Slider, Stack, Typography } from '@mui/material';
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

const toMs = (frameCount: number) =>
  Math.round((frameCount / engine.context.sampleRate) * 1000);

export type TimingDetailsProps = {
  disabled: boolean;
};

export const TimingDetails: FC<TimingDetailsProps> = (props) => {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement>();
  const latencyMs = toMs(useEngineStore(getRecordingLatencyFrameCount));
  const outputLatencyMs = toMs(useEngineStore(getOutputLatencyFrameCount));
  const inputLatencyMs = toMs(useEngineStore(getInputShareFrameCount));
  const source = useEngineStore((state) => state.latencySource);
  const sourceLabels: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.latencySource.calibrated'),
    estimated: t('pages.project.audioSettings.latencySource.estimated'),
    manual: t('pages.project.audioSettings.latencySource.manual'),
  };

  return (
    <>
      <Button
        aria-expanded={anchorEl !== undefined}
        aria-haspopup='dialog'
        disabled={props.disabled}
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        endIcon={<ExpandMoreRoundedIcon />}
        sx={{ ml: 'auto', color: 'text.secondary' }}
      >
        {t('pages.project.audioSettings.timing.details')}
      </Button>
      <Popover
        anchorEl={anchorEl}
        open={anchorEl !== undefined}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: '90vw' } } }}
      >
        <Stack sx={{ p: 4, gap: 2 }}>
          <Stack sx={{ gap: 0.5 }}>
            <Typography variant='body2'>
              {t('pages.project.audioSettings.latency', { value: latencyMs })}
            </Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {sourceLabels[source]}
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
      </Popover>
    </>
  );
};
