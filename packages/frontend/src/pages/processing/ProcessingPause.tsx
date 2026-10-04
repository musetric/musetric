import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';

export const ProcessingPause: FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const processing = useQuery(endpoints.processing.get());
  const pause = useMutation(endpoints.processing.pause(queryClient));
  const paused = processing.data?.paused ?? false;
  const label = paused
    ? t('pages.processing.resumeAll')
    : t('pages.processing.pauseAll');

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={processing.isPending || pause.isPending}
          color={paused ? 'primary' : 'inherit'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1 }}
          onClick={() => {
            pause.mutate({ paused: !paused });
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            {paused ? (
              <PlayCircleOutlineRoundedIcon fontSize='small' />
            ) : (
              <PauseCircleOutlineRoundedIcon fontSize='small' />
            )}
            <Typography variant='caption' lineHeight={1} noWrap>
              {paused
                ? t('pages.processing.resumeQueue')
                : t('pages.processing.pauseQueue')}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
