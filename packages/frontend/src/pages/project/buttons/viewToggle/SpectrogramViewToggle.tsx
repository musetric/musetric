import { Stack } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { NoteBarsIcon } from '../../../../icons/NoteBarsIcon.js';
import { SpectrogramIcon } from '../../../../icons/SpectrogramIcon.js';
import { ViewToggleButton } from './ViewToggleButton.js';

export const SpectrogramViewToggle: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack
      direction='row'
      gap={0.5}
      p={0.5}
      borderRadius={2}
      bgcolor='action.hover'
    >
      <ViewToggleButton
        target={{ panel: 'spectrogram', view: 'notes' }}
        icon={<NoteBarsIcon fontSize='small' />}
        label={t('pages.project.visualizationMode.notes')}
      />
      <ViewToggleButton
        target={{ panel: 'spectrogram', view: 'spectrum' }}
        icon={<SpectrogramIcon fontSize='small' />}
        label={t('pages.project.visualizationMode.spectrum')}
      />
    </Stack>
  );
};
