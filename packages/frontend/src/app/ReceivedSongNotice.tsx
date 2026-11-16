import CloseIcon from '@mui/icons-material/Close';
import { Button, IconButton, Snackbar } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { receivedSong, useReceivedSong } from './receivedSong.js';
import { routes } from './router/routes.js';

export const ReceivedSongNotice: FC = () => {
  const { t } = useTranslation();
  const song = useReceivedSong();
  const onList = routes.home.useMatch() !== undefined;
  const adding = routes.projectsCreate.useMatch() !== undefined;

  if (!song || song.status === 'copying' || onList || adding) {
    return undefined;
  }

  return (
    <Snackbar
      open
      onClose={(_, reason) => {
        if (reason === 'clickaway') return;
        receivedSong.finish(song.id);
      }}
      message={
        song.status === 'ready'
          ? t('app.receivedSong.message', { name: song.name })
          : t('app.receivedSong.failed')
      }
      action={
        <>
          {song.status === 'ready' && (
            <Button
              color='primary'
              size='small'
              onClick={() => routes.projectsCreate.navigate()}
            >
              {t('app.receivedSong.add')}
            </Button>
          )}
          <IconButton
            size='small'
            color='inherit'
            aria-label={t('app.receivedSong.close')}
            onClick={() => receivedSong.finish(song.id)}
          >
            <CloseIcon fontSize='small' />
          </IconButton>
        </>
      }
    />
  );
};
