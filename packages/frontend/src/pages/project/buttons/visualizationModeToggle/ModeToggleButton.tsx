import { Box, Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { useProjectStore, type VisualizationMode } from '../../store.js';

export type ModeToggleButtonProps = {
  mode: VisualizationMode;
  icon: ReactNode;
  label: string;
};

export const ModeToggleButton: FC<ModeToggleButtonProps> = (props) => {
  const { mode, icon, label } = props;
  const visualizationMode = useProjectStore((state) => state.visualizationMode);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const setVisualizationMode = useProjectStore(
    (state) => state.setVisualizationMode,
  );

  return (
    <Tooltip title={label}>
      <Box flex={{ xs: 1, sm: 'none' }}>
        <ToggleButton
          size='small'
          color='primary'
          fullWidth
          disabled={realtimeFailed}
          selected={visualizationMode === mode}
          value={mode}
          sx={{ border: 0, borderRadius: 2, px: 2, py: 1 }}
          onClick={() => {
            setVisualizationMode(mode);
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            {icon}
            <Typography
              variant='caption'
              lineHeight={1}
              noWrap
              textTransform='none'
            >
              {label}
            </Typography>
          </Stack>
        </ToggleButton>
      </Box>
    </Tooltip>
  );
};
