import { Stack, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';

export type ControlButtonContentProps = {
  icon: ReactNode;
  caption: string;
};

export const ControlButtonContent: FC<ControlButtonContentProps> = (props) => {
  const { icon, caption } = props;

  return (
    <Stack alignItems='center' gap={0.5}>
      {icon}
      <Typography component='span' variant='caption' lineHeight={1} noWrap>
        {caption}
      </Typography>
    </Stack>
  );
};
