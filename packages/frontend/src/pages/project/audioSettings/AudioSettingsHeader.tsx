import CloseIcon from '@mui/icons-material/Close';
import { IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store.js';

export const AudioSettingsHeader: FC = () => {
  const { t } = useTranslation();
  const setOpen = useProjectStore((state) => state.setAudioSettingsOpen);

  return (
    <Stack direction='row' alignItems='center'>
      <Typography variant='h6' sx={{ flexGrow: 1 }}>
        {t('pages.project.audioSettings.title')}
      </Typography>
      <IconButton size='small' onClick={() => setOpen(false)}>
        <CloseIcon />
      </IconButton>
    </Stack>
  );
};
