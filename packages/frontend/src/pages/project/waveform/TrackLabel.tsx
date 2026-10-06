import { alpha, Typography } from '@mui/material';
import { type StemType } from '@musetric/audio';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const stemLabels: Record<StemType, (t: TFunction) => string> = {
  lead: (t) => t('pages.project.waveform.stemType.lead'),
  backing: (t) => t('pages.project.waveform.stemType.backing'),
  instrumental: (t) => t('pages.project.waveform.stemType.instrumental'),
};

export type TrackLabelProps = (
  | {
      kind: 'delivery';
      stemType: StemType;
    }
  | {
      kind: 'recording';
    }
) & {
  variant?: 'overlay' | 'spectrogram' | 'inline';
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
      variant='caption'
      fontWeight={600}
      lineHeight={1}
      color='text.secondary'
      sx={(theme) => ({
        position: 'absolute',
        top: 12,
        left: 8,
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        ...(props.variant === 'spectrogram'
          ? { backgroundColor: alpha(theme.palette.common.black, 0.8) }
          : {
              backgroundColor: theme.palette.background.paper,
              backgroundImage: 'var(--Paper-overlay)',
            }),
        zIndex: 1,
        pointerEvents: 'none',
        userSelect: 'none',
      })}
    >
      {label}
    </Typography>
  );
};
