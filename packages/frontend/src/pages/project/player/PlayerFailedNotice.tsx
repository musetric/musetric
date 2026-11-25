import { Alert, Snackbar } from '@mui/material';
import { isPlaying, isRecording } from '@musetric/engine';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const PlayerFailedNotice: FC = () => {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);
  const starting = useEngineStore(
    (state) => isPlaying(state) || isRecording(state),
  );

  return (
    <Snackbar
      open={!closed && !starting}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        severity='error'
        onClose={() => {
          setClosed(true);
        }}
      >
        {t('pages.project.player.failed')}
      </Alert>
    </Snackbar>
  );
};
