import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { LyricsTextIcon } from '../../../icons/LyricsTextIcon.js';
import { useProjectStore } from '../store.js';

export const SubtitlesToggleButton: FC = () => {
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const subtitlesOpen = useProjectStore((state) => state.subtitlesOpen);
  const setSubtitlesOpen = useProjectStore((state) => state.setSubtitlesOpen);
  const label = t('pages.project.detailsMode.subtitles');

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={realtimeFailed}
          color={subtitlesOpen ? 'primary' : 'inherit'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1 }}
          onClick={() => {
            setSubtitlesOpen(!subtitlesOpen);
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            <LyricsTextIcon fontSize='small' />
            <Typography variant='caption' lineHeight={1} noWrap>
              {label}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
