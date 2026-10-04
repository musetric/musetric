import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';

export type FlowPauseProps = {
  projectId: number;
  paused: boolean;
};

export const FlowPause: FC<FlowPauseProps> = (props) => {
  const { projectId, paused } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pause = useMutation(
    endpoints.processing.pauseProject(queryClient, projectId),
  );
  const label = paused
    ? t('pages.processing.resumeProject')
    : t('pages.processing.pauseProject');

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={pause.isPending}
          color={paused ? 'primary' : 'inherit'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1 }}
          onClick={() => {
            pause.mutate({ paused: !paused });
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            {paused ? (
              <PlayArrowRoundedIcon fontSize='small' />
            ) : (
              <PauseRoundedIcon fontSize='small' />
            )}
            <Typography variant='caption' lineHeight={1} noWrap>
              {paused
                ? t('pages.processing.resume')
                : t('pages.processing.pause')}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
