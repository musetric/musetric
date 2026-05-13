import { Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { WaveformIcon } from '../../../../icons/WaveformIcon.js';
import { useProjectStore } from '../../store.js';

export const TracksButton: FC = () => {
  const { t } = useTranslation();
  const visualizationMode = useProjectStore((state) => state.visualizationMode);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setVisualizationMode = useProjectStore(
    (state) => state.setVisualizationMode,
  );

  return (
    <Tooltip title={t('pages.project.visualizationMode.tracks')}>
      <ToggleButton
        disabled={realtimeFailed}
        selected={visualizationMode === 'tracks'}
        value='tracks'
        onClick={() => {
          setVisualizationMode('tracks');
        }}
      >
        <Stack alignItems='center'>
          <WaveformIcon fontSize='small' />
          <Typography
            variant='caption'
            fontSize={10}
            lineHeight={1}
            textTransform='none'
          >
            {t('pages.project.visualizationMode.tracks')}
          </Typography>
        </Stack>
      </ToggleButton>
    </Tooltip>
  );
};
