import { IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TempoIcon } from '../../../icons/TempoIcon.js';
import { useProjectStore } from '../store.js';

export const TempoButton: FC = () => {
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const sourceTempoBpm = useEngineStore((state) => state.sourceTempoBpm);
  const tempoBpm = useEngineStore((state) => state.tempoBpm);
  const setTempoAnchorEl = useProjectStore((state) => state.setTempoAnchorEl);

  return (
    <IconButton
      color={tempoBpm !== sourceTempoBpm ? 'primary' : 'inherit'}
      disabled={!frameCount || recording || realtimeFailed}
      sx={{
        borderRadius: 1,
        px: 1,
        py: 0,
      }}
      onClick={(event) => {
        setTempoAnchorEl(event.currentTarget);
      }}
    >
      <Stack alignItems='center'>
        <TempoIcon fontSize='small' />
        <Typography
          component='span'
          variant='caption'
          fontSize={10}
          lineHeight={1}
        >
          {t('pages.project.player.controls.tempoValue', {
            value: tempoBpm,
          })}
        </Typography>
      </Stack>
    </IconButton>
  );
};
