import { Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { SpectrogramIcon } from '../../../../icons/SpectrogramIcon.js';
import { useProjectStore } from '../../store.js';

export const SpectrumButton: FC = () => {
  const { t } = useTranslation();
  const visualizationMode = useProjectStore((state) => state.visualizationMode);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setVisualizationMode = useProjectStore(
    (state) => state.setVisualizationMode,
  );

  return (
    <Tooltip title={t('pages.project.visualizationMode.spectrum')}>
      <ToggleButton
        disabled={realtimeFailed}
        selected={visualizationMode === 'spectrum'}
        value='spectrum'
        onClick={() => {
          setVisualizationMode('spectrum');
        }}
      >
        <Stack alignItems='center'>
          <SpectrogramIcon fontSize='small' />
          <Typography
            variant='caption'
            fontSize={10}
            lineHeight={1}
            textTransform='none'
          >
            {t('pages.project.visualizationMode.spectrum')}
          </Typography>
        </Stack>
      </ToggleButton>
    </Tooltip>
  );
};
