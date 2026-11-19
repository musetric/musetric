import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutputVolume } from './useOutputVolume.js';

const loudEnoughVolume = 1 / 3;

export type CalibrationVolumeProps = {
  gutter: number;
};

export const CalibrationVolume: FC<CalibrationVolumeProps> = (props) => {
  const { t } = useTranslation();
  const { outputVolume, setVolume } = useOutputVolume();
  if (!outputVolume) {
    return undefined;
  }
  const { volume, steps } = outputVolume;
  const low = volume < loudEnoughVolume;
  return (
    <Stack
      direction='row'
      sx={{ px: props.gutter, pt: 2, gap: 3, alignItems: 'center' }}
    >
      <VolumeUpIcon
        fontSize='small'
        sx={{ color: low ? 'warning.main' : 'text.secondary' }}
      />
      <Slider
        aria-label={t('pages.project.calibration.volume.label')}
        getAriaValueText={(value) =>
          value / steps < loudEnoughVolume
            ? t('pages.project.calibration.volume.low')
            : t('pages.project.calibration.volume.value', {
                value: Math.round((value / steps) * 100),
              })
        }
        size='small'
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
        sx={{
          flex: 1,
          py: 3,
          '& .MuiSlider-mark': {
            width: 2,
            height: 12,
            bgcolor: 'text.secondary',
          },
        }}
      />
      <Typography
        variant='body2'
        sx={{
          width: 36,
          textAlign: 'right',
          color: low ? 'warning.main' : 'text.primary',
        }}
      >
        {t('pages.project.calibration.volume.value', {
          value: Math.round(volume * 100),
        })}
      </Typography>
    </Stack>
  );
};
