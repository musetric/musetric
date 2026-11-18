import { Box, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type CalibrationTexts } from './calibrationTexts.js';
import { CalibrationVolume } from './CalibrationVolume.js';

export type CalibrationStepsProps = {
  bluetooth: boolean;
  texts: CalibrationTexts;
  gutter: number;
};

export const CalibrationSteps: FC<CalibrationStepsProps> = (props) => {
  const { bluetooth, texts, gutter } = props;
  const { t } = useTranslation();
  return (
    <Stack sx={{ px: gutter, pt: 4, gap: 4 }}>
      <Typography variant='body2' sx={{ color: 'text.secondary' }}>
        {bluetooth
          ? t('pages.project.calibration.lead.bluetooth')
          : t('pages.project.calibration.lead.other')}
      </Typography>
      <Box
        component='ol'
        sx={{
          m: 0,
          py: 3,
          pr: 3,
          pl: 7.5,
          borderRadius: 2.5,
          bgcolor: 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <Typography component='li' variant='body2'>
          {texts.place}
        </Typography>
        <Typography component='li' variant='body2'>
          {t('pages.project.calibration.volume.step')}
        </Typography>
      </Box>
      <CalibrationVolume />
    </Stack>
  );
};
