import { Box, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { CalibrationFigure } from './CalibrationFigure.js';
import { type CalibrationTexts } from './calibrationTexts.js';
import { CalibrationVolume } from './CalibrationVolume.js';

export type CalibrationStepsProps = {
  bluetooth: boolean;
  handheld: boolean;
  headphones: boolean;
  texts: CalibrationTexts;
  volume: number | undefined;
  gutter: number;
};

export const CalibrationSteps: FC<CalibrationStepsProps> = (props) => {
  const { bluetooth, handheld, headphones, texts, volume, gutter } = props;
  const { t } = useTranslation();
  return (
    <Stack sx={{ px: gutter, pt: 4, gap: 4 }}>
      <Typography variant='body2' sx={{ color: 'text.secondary' }}>
        {bluetooth
          ? t('pages.project.calibration.lead.bluetooth')
          : t('pages.project.calibration.lead.other')}
      </Typography>
      <Stack
        direction='row'
        sx={{
          gap: 4,
          alignItems: 'center',
          p: 3,
          borderRadius: 2.5,
          bgcolor: 'action.hover',
        }}
      >
        <CalibrationFigure
          handheld={handheld}
          headphones={headphones}
          label={texts.figure}
        />
        <Box
          component='ol'
          sx={{
            m: 0,
            pl: 4.5,
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
      </Stack>
      {volume !== undefined && <CalibrationVolume volume={volume} />}
    </Stack>
  );
};
