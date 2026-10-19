import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { alpha, Box, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const loudEnoughVolume = 0.5;

export type CalibrationVolumeProps = {
  volume: number;
};

export const CalibrationVolume: FC<CalibrationVolumeProps> = (props) => {
  const { volume } = props;
  const { t } = useTranslation();
  const low = volume < loudEnoughVolume;
  const percent = Math.round(volume * 100);
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack direction='row' sx={{ gap: 2.5, alignItems: 'center' }}>
        <VolumeUpIcon fontSize='small' sx={{ color: 'text.secondary' }} />
        <Box
          role='meter'
          aria-label={t('pages.project.calibration.volume.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          sx={(theme) => ({
            position: 'relative',
            flex: 1,
            height: 6,
            borderRadius: 1.5,
            bgcolor: alpha(theme.palette.text.primary, 0.14),
          })}
        >
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${percent}%`,
              borderRadius: 1.5,
              bgcolor: low ? 'warning.main' : 'primary.main',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              left: `${loudEnoughVolume * 100}%`,
              top: -3,
              width: 2,
              height: 12,
              bgcolor: 'text.secondary',
            }}
          />
        </Box>
        <Typography variant='body2' sx={{ width: 36, textAlign: 'right' }}>
          {t('pages.project.calibration.volume.value', { value: percent })}
        </Typography>
      </Stack>
      <Typography
        variant='caption'
        sx={{ color: low ? 'warning.main' : 'text.secondary' }}
      >
        {low
          ? t('pages.project.calibration.volume.low')
          : t('pages.project.calibration.volume.ok')}
      </Typography>
    </Stack>
  );
};
