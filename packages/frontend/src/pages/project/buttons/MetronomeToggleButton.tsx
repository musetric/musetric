import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { MetronomeIcon } from '../../../icons/MetronomeIcon.js';

export const MetronomeToggleButton: FC = () => {
  const { t } = useTranslation();
  const metronomeEnabled = useEngineStore((state) => state.metronomeEnabled);

  return (
    <Tooltip title={t('pages.project.detailsMode.metronome')}>
      <IconButton
        size='small'
        color={metronomeEnabled ? 'primary' : 'inherit'}
        aria-label={t('pages.project.detailsMode.metronome')}
        sx={{
          borderRadius: 1,
          px: 1,
          py: 0,
        }}
        onClick={() => {
          engine.store.update((state) => {
            state.metronomeEnabled = !state.metronomeEnabled;
          });
        }}
      >
        <Stack alignItems='center'>
          <MetronomeIcon fontSize='small' />
          <Typography
            component='span'
            variant='caption'
            fontSize={10}
            lineHeight={1}
          >
            {t('pages.project.detailsMode.metronome')}
          </Typography>
        </Stack>
      </IconButton>
    </Tooltip>
  );
};
