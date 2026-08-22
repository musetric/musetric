import { IconButton, Tooltip } from '@mui/material';
import { type FC, type MouseEvent, type ReactNode } from 'react';
import { ControlButtonContent } from './ControlButtonContent.js';
import { controlButtonSx } from './controlButtonSx.js';

export type ControlButtonProps = {
  icon: ReactNode;
  label: string;
  value?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const ControlButton: FC<ControlButtonProps> = (props) => {
  const { icon, label, value, active, disabled, onClick } = props;

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size='small'
          disabled={disabled}
          color={active ? 'primary' : 'inherit'}
          aria-label={label}
          onClick={onClick}
          sx={controlButtonSx}
        >
          <ControlButtonContent icon={icon} caption={value ?? label} />
        </IconButton>
      </span>
    </Tooltip>
  );
};
