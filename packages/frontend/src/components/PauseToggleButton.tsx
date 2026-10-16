import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';

export type PauseToggleButtonProps = {
  paused: boolean;
  disabled: boolean;
  label: string;
  caption: string;
  icon: ReactNode;
  onToggle: () => void;
};

export const PauseToggleButton: FC<PauseToggleButtonProps> = (props) => {
  const { paused, disabled, label, caption, icon, onToggle } = props;

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={disabled}
          color={paused ? 'primary' : 'inherit'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1 }}
          onClick={onToggle}
        >
          <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
            {icon}
            <Typography variant='caption' noWrap sx={{ lineHeight: 1 }}>
              {caption}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
