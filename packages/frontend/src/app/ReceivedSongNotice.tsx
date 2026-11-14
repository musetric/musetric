import CloseIcon from '@mui/icons-material/Close';
import { Button, IconButton, Snackbar } from '@mui/material';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isReceivedSongWaiting,
  subscribeReceivedSongApplying,
  subscribeReceivedSongs,
} from './receivedSong.js';
import { routes } from './router/routes.js';

export const ReceivedSongNotice: FC = () => {
  const { t } = useTranslation();
  const onProject = routes.project.useMatch() !== undefined;
  const [waiting, setWaiting] = useState(isReceivedSongWaiting);
  const [dismissed, setDismissed] = useState(false);
  const [checkedOnProject, setCheckedOnProject] = useState(onProject);

  if (checkedOnProject !== onProject) {
    setCheckedOnProject(onProject);
    setWaiting(isReceivedSongWaiting());
  }

  useEffect(
    () =>
      subscribeReceivedSongs(() => {
        setWaiting(isReceivedSongWaiting());
        setDismissed(false);
      }),
    [],
  );

  useEffect(
    () =>
      subscribeReceivedSongApplying(() => {
        setWaiting(isReceivedSongWaiting());
      }),
    [],
  );

  return (
    <Snackbar
      open={onProject && waiting && !dismissed}
      onClose={(_, reason) => {
        if (reason === 'clickaway') return;
        setDismissed(true);
      }}
      message={t('app.receivedSong.message')}
      action={
        <>
          <Button
            color='primary'
            size='small'
            onClick={() => routes.projectsCreate.navigate()}
          >
            {t('app.receivedSong.add')}
          </Button>
          <IconButton
            size='small'
            color='inherit'
            aria-label={t('app.receivedSong.close')}
            onClick={() => setDismissed(true)}
          >
            <CloseIcon fontSize='small' />
          </IconButton>
        </>
      }
    />
  );
};
