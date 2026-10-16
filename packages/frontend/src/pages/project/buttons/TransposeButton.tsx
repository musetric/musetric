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
import { TransposeIcon } from '../../../icons/TransposeIcon.js';
import { useProjectStore } from '../store.js';
import { useKeyCaption } from './useKeyCaption.js';

export const TransposeButton: FC = () => {
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setTransposeAnchorEl = useProjectStore(
    (state) => state.setTransposeAnchorEl,
  );
  const keyCaption = useKeyCaption();

  return (
    <Tooltip title={keyCaption.label}>
      <Box>
        <IconButton
          size='small'
          disabled={!frameCount || recording || realtimeFailed}
          color={keyCaption.changed ? 'primary' : 'inherit'}
          aria-label={keyCaption.label}
          sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
          onClick={(event) => {
            setTransposeAnchorEl(event.currentTarget);
          }}
        >
          <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
            <Badge
              badgeContent={keyCaption.badge}
              color='primary'
              invisible={keyCaption.badge === undefined}
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
              <TransposeIcon fontSize='small' />
            </Badge>
            <Typography variant='caption' noWrap sx={{ lineHeight: 1 }}>
              {keyCaption.caption}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
