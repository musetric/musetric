import { Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { type FC, type PropsWithChildren, useEffect } from 'react';
import { endpoints } from '../api/index.js';
import { safeAreaPadding } from './theme/safeArea.js';

export const AppPage: FC<PropsWithChildren> = (props) => {
  const queryClient = useQueryClient();
  useEffect(
    () => endpoints.project.subscribeToStatus(queryClient),
    [queryClient],
  );

  return (
    <Stack
      direction='column'
      gap={4}
      width='100%'
      height='100dvh'
      overflow='auto'
      sx={(theme) => ({
        scrollbarGutter: 'stable',
        ...safeAreaPadding(theme, 4),
      })}
    >
      {props.children}
    </Stack>
  );
};
