import { alpha, Box, Stack, type Theme, Typography } from '@mui/material';
import { type CalibrationClick } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const getClickColor = (theme: Theme, click: CalibrationClick) => {
  const colors: Record<CalibrationClick, string> = {
    pending: alpha(theme.palette.text.primary, 0.14),
    clear: theme.palette.success.main,
    faint: theme.palette.warning.main,
    stray: theme.palette.warning.main,
    missed: theme.palette.error.main,
  };
  return colors[click];
};

export type CalibrationProgressProps = {
  gutter: number;
};

export const CalibrationProgress: FC<CalibrationProgressProps> = (props) => {
  const { t } = useTranslation();
  const clicks = useEngineStore((state) => state.calibrationClicks);
  const clickIndex = useEngineStore((state) => state.calibrationClickIndex);
  const judged = clicks.filter((click) => click !== 'pending').length;
  return (
    <Stack
      sx={{ px: props.gutter, pt: 6, pb: 1, gap: 3.5, alignItems: 'center' }}
    >
      <Stack
        role='progressbar'
        aria-label={t('pages.project.calibration.measuring.label')}
        aria-valuemin={0}
        aria-valuemax={clicks.length}
        aria-valuenow={judged}
        direction='row'
        sx={{ gap: 3 }}
      >
        {clicks.map((click, index) => (
          <Box
            key={index}
            sx={(theme) => ({
              width: 18,
              height: 18,
              borderRadius: '50%',
              bgcolor: getClickColor(theme, click),
              transition: 'background-color 150ms',
            })}
          />
        ))}
      </Stack>
      <Typography variant='body1'>
        {t('pages.project.calibration.measuring.click', {
          current: Math.min(clicks.length, Math.max(1, clickIndex + 1)),
          total: clicks.length,
        })}
      </Typography>
      <Typography variant='body2' sx={{ color: 'text.secondary' }}>
        {t('pages.project.calibration.measuring.hint')}
      </Typography>
    </Stack>
  );
};
