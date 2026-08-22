import { Typography } from '@mui/material';
import { type StemType } from '@musetric/audio';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type TrackVolumeTarget } from '../mix/trackVolume.js';

const stemLabels: Record<StemType, (t: TFunction) => string> = {
  lead: (t) => t('pages.project.waveform.stemType.lead'),
  backing: (t) => t('pages.project.waveform.stemType.backing'),
  instrumental: (t) => t('pages.project.waveform.stemType.instrumental'),
};

export type TrackLabelProps = TrackVolumeTarget & {
  variant?: 'overlay' | 'inline';
};

export const TrackLabel: FC<TrackLabelProps> = (props) => {
  const { t } = useTranslation();
  const label =
    props.kind === 'recording'
      ? t('pages.project.waveform.stemType.recording')
      : stemLabels[props.stemType](t);

  if (props.variant === 'inline') {
    return (
      <Typography variant='subtitle2' color='text.primary'>
        {label}
      </Typography>
    );
  }

  return (
    <Typography
      variant='subtitle2'
      color='text.secondary'
      sx={{
        position: 'absolute',
        top: 10,
        left: 12,
        zIndex: 1,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {label}
    </Typography>
  );
};
