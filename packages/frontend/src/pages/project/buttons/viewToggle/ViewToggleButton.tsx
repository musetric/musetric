import { Box, Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { type SpectrogramViewMode } from '@musetric/engine';
import { type FC, type ReactNode } from 'react';
import { engine } from '../../../../engine/engine.js';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { type DetailsView, useProjectStore } from '../../store.js';

export type ViewToggleTarget =
  | {
      panel: 'details';
      view: DetailsView;
    }
  | {
      panel: 'spectrogram';
      view: SpectrogramViewMode;
    };

export type ViewToggleButtonProps = {
  target: ViewToggleTarget;
  icon: ReactNode;
  label: string;
};

export const ViewToggleButton: FC<ViewToggleButtonProps> = (props) => {
  const { target, icon, label } = props;
  const detailsView = useProjectStore((state) => state.detailsView);
  const setDetailsView = useProjectStore((state) => state.setDetailsView);
  const spectrogramView = useEngineStore((state) => state.spectrogramView);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const selected =
    target.panel === 'details'
      ? detailsView === target.view
      : spectrogramView === target.view;

  return (
    <Tooltip title={label}>
      <Box>
        <ToggleButton
          size='small'
          color='primary'
          disabled={realtimeFailed}
          selected={selected}
          value={target.view}
          sx={{ border: 0, borderRadius: 2, px: 2, py: 1, minWidth: 68 }}
          onClick={() => {
            if (target.panel === 'details') {
              setDetailsView(selected ? undefined : target.view);
              return;
            }
            engine.store.update((state) => {
              state.spectrogramView = target.view;
            });
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
