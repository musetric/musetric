import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
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
  const label = t('pages.project.player.controls.tempo');

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={!frameCount || recording || realtimeFailed}
          color={tempoBpm === sourceTempoBpm ? 'inherit' : 'primary'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
          onClick={(event) => {
            setTempoAnchorEl(event.currentTarget);
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            <TempoIcon fontSize='small' />
            <Typography variant='caption' lineHeight={1} noWrap>
              {tempoBpm}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
