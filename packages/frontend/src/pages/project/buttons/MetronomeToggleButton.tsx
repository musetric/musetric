import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { MetronomeIcon } from '../../../icons/MetronomeIcon.js';

export const MetronomeToggleButton: FC = () => {
  const { t } = useTranslation();
  const metronomeEnabled = useEngineStore((state) => state.metronomeEnabled);
  const label = t('pages.project.detailsMode.metronome');

  return (
    <Tooltip title={label}>
      <IconButton
        size='small'
        color={metronomeEnabled ? 'primary' : 'inherit'}
        aria-label={label}
        sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
        onClick={() => {
          engine.store.update((state) => {
            state.metronomeEnabled = !state.metronomeEnabled;
          });
        }}
      >
        <Stack alignItems='center' gap={0.5}>
          <MetronomeIcon fontSize='small' />
          <Typography variant='caption' lineHeight={1} noWrap>
            {t('pages.project.detailsMode.metronomeCaption')}
          </Typography>
        </Stack>
      </IconButton>
    </Tooltip>
  );
};
