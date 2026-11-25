import { Alert, Snackbar } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../engine/useEngineStore.js';

export const RealtimeNotice: FC = () => {
  const { t } = useTranslation();
  const status = useEngineStore((state) => state.statuses.realtime);
  const [shown, setShown] = useState(status);
  const [restored, setRestored] = useState(false);
  if (status !== shown) {
    setShown(status);
    setRestored(shown === 'error' && status === 'success');
  }

  return (
    <>
      {status === 'error' && (
        <Alert severity='error'>{t('pages.project.realtime.error')}</Alert>
      )}
      <Snackbar
        open={restored}
        autoHideDuration={3000}
        onClose={() => {
          setRestored(false);
        }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity='success'>{t('pages.project.realtime.restored')}</Alert>
      </Snackbar>
    </>
  );
};
