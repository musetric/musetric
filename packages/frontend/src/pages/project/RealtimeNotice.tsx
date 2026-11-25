import { Alert } from '@mui/material';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../engine/useEngineStore.js';

const restoredNoticeMs = 3000;

export const RealtimeNotice: FC = () => {
  const { t } = useTranslation();
  const status = useEngineStore((state) => state.statuses.realtime);
  const [shown, setShown] = useState(status);
  const [restored, setRestored] = useState(false);
  if (status !== shown) {
    setShown(status);
    setRestored(shown === 'error' && status === 'success');
  }

  useEffect(() => {
    if (!restored) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setRestored(false);
    }, restoredNoticeMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [restored]);

  if (status === 'error') {
    return <Alert severity='error'>{t('pages.project.realtime.error')}</Alert>;
  }
  if (restored) {
    return (
      <Alert severity='success'>{t('pages.project.realtime.restored')}</Alert>
    );
  }
  return undefined;
};
