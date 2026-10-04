import { Stack } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { NoteBarsIcon } from '../../../../icons/NoteBarsIcon.js';
import { SpectrogramIcon } from '../../../../icons/SpectrogramIcon.js';
import { WaveformIcon } from '../../../../icons/WaveformIcon.js';
import { ModeToggleButton } from './ModeToggleButton.js';

export const VisualizationModeToggle: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack
      direction='row'
      gap={{ xs: 1, sm: 0.5 }}
      p={{ xs: 0, sm: 0.5 }}
      borderRadius={2}
      sx={{ backgroundColor: { xs: 'transparent', sm: 'action.hover' } }}
    >
      <ModeToggleButton
        mode='tracks'
        icon={<WaveformIcon fontSize='small' />}
        label={t('pages.project.visualizationMode.tracks')}
      />
      <ModeToggleButton
        mode='notes'
        icon={<NoteBarsIcon fontSize='small' />}
        label={t('pages.project.visualizationMode.notes')}
      />
      <ModeToggleButton
        mode='spectrum'
        icon={<SpectrogramIcon fontSize='small' />}
        label={t('pages.project.visualizationMode.spectrum')}
      />
    </Stack>
  );
};
