import { Box, Stack } from '@mui/material';
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
      gap={0.5}
      p={0.5}
      borderRadius={2}
      sx={{ backgroundColor: 'background.paper' }}
    >
      <Box display='none'>
        <ModeToggleButton
          mode='tracks'
          icon={<WaveformIcon fontSize='small' />}
          label={t('pages.project.visualizationMode.tracks')}
        />
      </Box>
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
