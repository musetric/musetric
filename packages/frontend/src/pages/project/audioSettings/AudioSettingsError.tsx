import { Alert } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const AudioSettingsError: FC = () => {
  const { t } = useTranslation();
  const error = useEngineStore((state) => state.calibrationError);
  if (!error) {
    return undefined;
  }
  if (error === 'preview') {
    return (
      <Alert severity='error'>
        {t('pages.project.audioSettings.previewError')}
      </Alert>
    );
  }
  if (error === 'output') {
    return (
      <Alert severity='error'>
        {t('pages.project.audioSettings.outputError')}
      </Alert>
    );
  }
  return (
    <Alert severity='error'>
      {t('pages.project.audioSettings.calibrationFailed')}
    </Alert>
  );
};
