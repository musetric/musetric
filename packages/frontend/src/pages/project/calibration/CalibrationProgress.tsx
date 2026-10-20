import { alpha, Box, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const clickTotal = 5;

export type CalibrationProgressProps = {
  gutter: number;
};

export const CalibrationProgress: FC<CalibrationProgressProps> = (props) => {
  const { t } = useTranslation();
  const clickCount = useEngineStore((state) => state.calibrationClickCount);
  return (
    <Stack
      sx={{ px: props.gutter, pt: 6, pb: 1, gap: 3.5, alignItems: 'center' }}
    >
      <Stack
        role='progressbar'
        aria-label={t('pages.project.calibration.measuring.label')}
        aria-valuemin={0}
        aria-valuemax={clickTotal}
        aria-valuenow={clickCount}
        direction='row'
        sx={{ gap: 3 }}
      >
        {Array.from({ length: clickTotal }, (_, index) => (
          <Box
            key={index}
            sx={(theme) => ({
              width: 18,
              height: 18,
              borderRadius: '50%',
              bgcolor:
                index < clickCount
                  ? theme.palette.primary.main
                  : alpha(theme.palette.text.primary, 0.14),
            })}
          />
        ))}
      </Stack>
      <Typography variant='body1'>
        {t('pages.project.calibration.measuring.click', {
          current: Math.min(clickTotal, Math.max(1, clickCount)),
          total: clickTotal,
        })}
      </Typography>
      <Typography variant='body2' sx={{ color: 'text.secondary' }}>
        {t('pages.project.calibration.measuring.hint')}
      </Typography>
    </Stack>
  );
};
