import { ToggleButton, Tooltip } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { useEngineStore } from '../../../../engine/useEngineStore.js';
import { useProjectStore, type VisualizationMode } from '../../store.js';
import { ControlButtonContent } from '../ControlButtonContent.js';
import { controlButtonSx } from '../controlButtonSx.js';

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
      <span>
        <ToggleButton
          size='small'
          disabled={realtimeFailed}
          selected={visualizationMode === mode}
          value={mode}
          sx={controlButtonSx}
          onClick={() => {
            setVisualizationMode(mode);
          }}
        >
          <ControlButtonContent icon={icon} caption={label} />
        </ToggleButton>
      </span>
    </Tooltip>
  );
};
