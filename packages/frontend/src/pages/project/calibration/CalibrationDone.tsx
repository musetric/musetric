import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { alpha, Box, Stack, Typography } from '@mui/material';
import { getOutputLatencyFrameCount } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type CalibrationDoneProps = {
  headphones: boolean;
  outputLabel: string;
  gutter: number;
};

export const CalibrationDone: FC<CalibrationDoneProps> = (props) => {
  const { headphones, outputLabel, gutter } = props;
  const { t } = useTranslation();
  const outputFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const seconds = (outputFrameCount / engine.context.sampleRate).toFixed(2);
  return (
    <Stack sx={{ px: gutter, pt: 4, gap: 2.5 }}>
      <Stack direction='row' sx={{ gap: 3, alignItems: 'center' }}>
        <Box
          sx={(theme) => ({
            width: 32,
            height: 32,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.16),
          })}
        >
          <CheckRoundedIcon fontSize='small' />
        </Box>
        <Typography variant='subtitle1' sx={{ fontWeight: 500 }}>
          {t('pages.project.calibration.result.title')}
        </Typography>
      </Stack>
      <Typography variant='body2'>
        {headphones
          ? t('pages.project.calibration.result.headphones', { seconds })
          : t('pages.project.calibration.result.output', { seconds })}
      </Typography>
      <Typography variant='caption' sx={{ color: 'text.secondary' }}>
        {t('pages.project.calibration.result.saved', { output: outputLabel })}
      </Typography>
    </Stack>
  );
};
