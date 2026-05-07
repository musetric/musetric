import { Typography } from '@mui/material';
import { type StemType } from '@musetric/audio';
import type { TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const stemLabels: Record<StemType, (t: TFunction) => string> = {
  lead: (t) => t('pages.project.waveform.stemType.lead'),
  backing: (t) => t('pages.project.waveform.stemType.backing'),
  instrumental: (t) => t('pages.project.waveform.stemType.instrumental'),
};

export type TrackStemLabelProps = {
  stemType: StemType;
};

export const TrackStemLabel: FC<TrackStemLabelProps> = (props) => {
  const { stemType } = props;
  const { t } = useTranslation();

  return (
    <Typography
      variant='subtitle2'
      fontWeight={600}
      color='text.secondary'
      sx={{
        position: 'absolute',
        top: 10,
        left: 12,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      {stemLabels[stemType](t)}
    </Typography>
  );
};
