import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import {
  getOutputLatencyFrameCount,
  getRecordingLatencyFrameCount,
  type RecordingLatencySource,
} from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

export const TimingRow: FC = () => {
  const { t } = useTranslation();
  const setAudioSettingsOpen = useProjectStore(
    (state) => state.setAudioSettingsOpen,
  );
  const setCalibrationPrompt = useProjectStore(
    (state) => state.setCalibrationPrompt,
  );
  const source = useEngineStore((state) => state.latencySource);
  const outputFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const latencyFrameCount = useEngineStore(getRecordingLatencyFrameCount);
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const { sampleRate } = engine.context;
  const statuses: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.timing.calibrated', {
      seconds: (outputFrameCount / sampleRate).toFixed(2),
    }),
    estimated: t('pages.project.audioSettings.timing.needed'),
    manual: t('pages.project.audioSettings.timing.manual', {
      value: Math.round((latencyFrameCount / sampleRate) * 1000),
    }),
  };

  return (
    <Stack sx={{ gap: 1 }}>
      <ButtonBase
        disabled={recording || calibrating}
        onClick={() => {
          setAudioSettingsOpen(false);
          setCalibrationPrompt('settings');
        }}
        sx={{
          minHeight: 60,
          mx: -2,
          px: 2,
          borderRadius: 1,
          justifyContent: 'flex-start',
          textAlign: 'left',
          gap: 3,
          '&.Mui-disabled': { opacity: 0.5 },
        }}
      >
        <Stack sx={{ flex: 1, gap: 1 }}>
          <Typography variant='body1'>
            {t('pages.project.audioSettings.timing.title')}
          </Typography>
          <Stack direction='row' sx={{ gap: 2, alignItems: 'center' }}>
            {source === 'calibrated' ? (
              <CheckRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            ) : (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor:
                    source === 'estimated' ? 'warning.main' : 'text.secondary',
                }}
              />
            )}
            <Typography variant='body2' sx={{ color: 'text.secondary' }}>
              {statuses[source]}
            </Typography>
          </Stack>
        </Stack>
        <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
      </ButtonBase>
      {recording && (
        <Typography variant='caption' sx={{ color: 'text.secondary' }}>
          {t('pages.project.audioSettings.deviceLocked')}
        </Typography>
      )}
    </Stack>
  );
};
