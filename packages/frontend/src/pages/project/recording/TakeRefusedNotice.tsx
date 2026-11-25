import { Alert, Snackbar } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const TakeRefusedNotice: FC = () => {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);
  const reason = useEngineStore((state) => state.takeRefusal);

  return (
    <Snackbar
      open={!closed}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
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
    </Snackbar>
  );
};
