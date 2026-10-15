import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { Stack, Typography } from '@mui/material';
import { type FC } from 'react';

export type ViewErrorProps = {
  message: string;
};

export const ViewError: FC<ViewErrorProps> = (props) => {
  const { message } = props;

  return (
    <Stack
      sx={{
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
      }}
    >
      <ErrorOutlineIcon color='error' fontSize='medium' />
      <Typography
        variant='body2'
        sx={{ color: 'text.primary', textAlign: 'center' }}
      >
        {message}
      </Typography>
    </Stack>
  );
};
