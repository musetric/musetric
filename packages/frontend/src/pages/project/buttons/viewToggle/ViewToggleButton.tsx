import { Box, Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { useProjectStore } from '../../store.js';
import {
  isViewSelected,
  toggleView,
  type ViewToggleTarget,
} from './viewToggle.js';

export type ViewToggleButtonProps = {
  target: ViewToggleTarget;
  icon: ReactNode;
  label: string;
};

export const ViewToggleButton: FC<ViewToggleButtonProps> = (props) => {
  const { target, icon, label } = props;
  const detailsView = useProjectStore((state) => state.detailsView);
  const spectrogramOpen = useProjectStore((state) => state.spectrogramOpen);
  const spectrogramView = useEngineStore((state) => state.spectrogramView);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const selected = isViewSelected(target, {
    detailsView,
    spectrogramOpen,
    spectrogramView,
  });

  return (
    <Tooltip title={label}>
      <Box sx={{ flex: '1 1 68px', minWidth: 0 }}>
        <ToggleButton
          fullWidth
          size='small'
          color='primary'
          disabled={realtimeFailed}
          selected={selected}
          value={target.view}
          sx={{ border: 0, borderRadius: 2, px: 1, py: 1 }}
          onClick={() => {
            toggleView(target);
          }}
        >
          <Stack sx={{ alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {icon}
            <Typography
              variant='caption'
              noWrap
              sx={{ lineHeight: 1, textTransform: 'none' }}
            >
              {label}
            </Typography>
          </Stack>
        </ToggleButton>
      </Box>
    </Tooltip>
  );
};
