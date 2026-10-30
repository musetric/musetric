import { alpha, Box, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../settings/store.js';

type LegendItemProps = {
  color: string;
  label: string;
};

const LegendItem: FC<LegendItemProps> = (props) => {
  const { color, label } = props;

  return (
    <Stack direction='row' sx={{ alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
      <Typography variant='caption' sx={{ fontWeight: 600, lineHeight: 1 }}>
        {label}
      </Typography>
    </Stack>
  );
};

export const HarmonicComparisonLegend: FC = () => {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.harmonicComparison.enabled);

  if (!enabled) {
    return undefined;
  }

  return (
    <Stack
      direction='row'
      sx={(theme) => ({
        gap: 1,
        position: 'absolute',
        top: 12,
        right: 8,
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        color: 'text.secondary',
        backgroundColor: alpha(theme.palette.common.black, 0.8),
        pointerEvents: 'none',
      })}
    >
      <LegendItem
        color='info.main'
        label={t('pages.project.spectrogram.quieter')}
      />
      <LegendItem
        color='warning.main'
        label={t('pages.project.spectrogram.louder')}
      />
    </Stack>
  );
};
