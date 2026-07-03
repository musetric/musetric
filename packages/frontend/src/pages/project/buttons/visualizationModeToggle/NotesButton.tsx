import { Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { NoteBarsIcon } from '../../../../icons/NoteBarsIcon.js';
import { useProjectStore } from '../../store.js';

export const NotesButton: FC = () => {
  const { t } = useTranslation();
  const visualizationMode = useProjectStore((state) => state.visualizationMode);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setVisualizationMode = useProjectStore(
    (state) => state.setVisualizationMode,
  );

  return (
    <Tooltip title={t('pages.project.visualizationMode.notes')}>
      <ToggleButton
        disabled={realtimeFailed}
        selected={visualizationMode === 'notes'}
        value='notes'
        onClick={() => {
          setVisualizationMode('notes');
        }}
      >
        <Stack alignItems='center'>
          <NoteBarsIcon fontSize='small' />
          <Typography
            variant='caption'
            fontSize={10}
            lineHeight={1}
            textTransform='none'
          >
            {t('pages.project.visualizationMode.notes')}
          </Typography>
        </Stack>
      </ToggleButton>
    </Tooltip>
  );
};
