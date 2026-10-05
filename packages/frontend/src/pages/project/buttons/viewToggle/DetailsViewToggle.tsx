import { Stack } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { LyricsTextIcon } from '../../../../icons/LyricsTextIcon.js';
import { WaveformIcon } from '../../../../icons/WaveformIcon.js';
import { ViewToggleButton } from './ViewToggleButton.js';

export const DetailsViewToggle: FC = () => {
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
        target={{ panel: 'details', view: 'text' }}
        icon={<LyricsTextIcon fontSize='small' />}
        label={t('pages.project.detailsView.text')}
      />
      <ViewToggleButton
        target={{ panel: 'details', view: 'tracks' }}
        icon={<WaveformIcon fontSize='small' />}
        label={t('pages.project.detailsView.tracks')}
      />
    </Stack>
  );
};
