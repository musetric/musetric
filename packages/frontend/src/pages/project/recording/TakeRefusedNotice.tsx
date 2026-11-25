import { Alert } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const TakeRefusedNotice: FC = () => {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);
  const reason = useEngineStore((state) => state.takeRefusal);

  if (closed) {
    return undefined;
  }
  return (
    <Alert
      severity='warning'
      onClose={() => {
        setClosed(true);
      }}
    >
      {reason === 'busy' && t('pages.project.take.refused.busy')}
      {reason === 'failed' && t('pages.project.take.refused.failed')}
      {reason === 'ended' && t('pages.project.take.refused.ended')}
    </Alert>
  );
};
