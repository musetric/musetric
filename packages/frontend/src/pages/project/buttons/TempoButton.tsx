import {
  Badge,
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TempoIcon } from '../../../icons/TempoIcon.js';
import { useProjectStore } from '../store.js';
import { useTempoCaption } from './useTempoCaption.js';

export const TempoButton: FC = () => {
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setTempoAnchorEl = useProjectStore((state) => state.setTempoAnchorEl);
  const tempoCaption = useTempoCaption();

  return (
    <Tooltip title={tempoCaption.label}>
      <Box>
        <IconButton
          size='small'
          disabled={!frameCount || recording || realtimeFailed}
          color={tempoCaption.changed ? 'primary' : 'inherit'}
          aria-label={tempoCaption.label}
          sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
          onClick={(event) => {
            setTempoAnchorEl(event.currentTarget);
          }}
        >
          <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
            <Badge
              badgeContent={tempoCaption.badge}
              max={999}
              color='primary'
              invisible={tempoCaption.badge === undefined}
              sx={{
                '& .MuiBadge-badge': {
                  height: 16,
                  minWidth: 16,
                  px: 1,
                  fontSize: 10,
                  fontWeight: 700,
                },
              }}
            >
              <TempoIcon fontSize='small' />
            </Badge>
            <Typography variant='caption' noWrap sx={{ lineHeight: 1 }}>
              {tempoCaption.caption}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
