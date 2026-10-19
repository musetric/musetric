import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutputVolume } from './useOutputVolume.js';

const loudEnoughVolume = 1 / 3;

export const CalibrationVolume: FC = () => {
  const { t } = useTranslation();
  const { outputVolume, setVolume } = useOutputVolume();
  if (!outputVolume) {
    return undefined;
  }
  const { volume, steps } = outputVolume;
  const low = volume < loudEnoughVolume;
  return (
    <Stack sx={{ gap: 0.5 }}>
      <Stack direction='row' sx={{ gap: 3, alignItems: 'center' }}>
        <VolumeUpIcon fontSize='small' sx={{ color: 'text.secondary' }} />
        <Slider
          aria-label={t('pages.project.calibration.volume.label')}
          min={0}
          max={steps}
          step={1}
          value={Math.round(volume * steps)}
          marks={[{ value: steps * loudEnoughVolume }]}
          color={low ? 'warning' : 'primary'}
          onChange={(_, value) => {
            if (Array.isArray(value)) {
              return;
            }
            setVolume(value / steps);
          }}
          sx={{ flex: 1 }}
        />
        <Typography variant='body2' sx={{ width: 36, textAlign: 'right' }}>
          {t('pages.project.calibration.volume.value', {
            value: Math.round(volume * 100),
          })}
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
