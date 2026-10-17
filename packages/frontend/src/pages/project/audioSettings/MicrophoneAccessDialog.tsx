import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { type MicrophoneDenial } from '@musetric/engine';
import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const useDenialText = (denial: MicrophoneDenial | undefined) => {
  const { t } = useTranslation();
  if (denial === 'app') {
    return t('pages.project.microphoneAccess.app');
  }
  if (denial === 'system') {
    return t('pages.project.microphoneAccess.system');
  }
  return t('pages.project.microphoneAccess.page');
};

const useRecheckOnReturn = (active: boolean) => {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const recheck = () => {
      if (document.visibilityState === 'visible') {
        void engine.microphoneAccess.recheck();
      }
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [active]);
};

export const MicrophoneAccessDialog: FC = () => {
  const { t } = useTranslation();
  const denial = useEngineStore((state) => state.microphoneDenial);
  const open = useEngineStore((state) => state.microphoneDenialOpen);
  const text = useDenialText(denial);
  const canOpenSettings =
    denial !== undefined && engine.microphoneAccess.canOpenSettings();

  useRecheckOnReturn(open && canOpenSettings);

  const dismiss = () => {
    engine.microphoneAccess.dismiss();
  };

  return (
    <Dialog
      open={open && denial !== undefined}
      onClose={dismiss}
      fullWidth
      maxWidth='xs'
    >
      {denial && (
        <>
          <DialogTitle>{t('pages.project.microphoneAccess.title')}</DialogTitle>
          <DialogContent>
            <Typography variant='body2' sx={{ color: 'text.secondary' }}>
              {text}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={dismiss}>
              {canOpenSettings
                ? t('pages.project.microphoneAccess.notNow')
                : t('pages.project.microphoneAccess.close')}
            </Button>
            {canOpenSettings ? (
              <Button
                variant='contained'
                onClick={() => {
                  engine.microphoneAccess.openSettings();
                }}
              >
                {t('pages.project.microphoneAccess.openSettings')}
              </Button>
            ) : (
              <Button
                variant='contained'
                onClick={() => {
                  void engine.microphoneAccess.recheck();
                }}
              >
                {t('pages.project.microphoneAccess.tryAgain')}
              </Button>
            )}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
};
