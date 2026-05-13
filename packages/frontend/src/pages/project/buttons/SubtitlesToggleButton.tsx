import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
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

  return (
    <Tooltip title={t('pages.project.detailsMode.subtitles')}>
      <IconButton
        size='small'
        disabled={realtimeFailed}
        color={subtitlesOpen ? 'primary' : 'inherit'}
        aria-label={t('pages.project.detailsMode.subtitles')}
        sx={{
          borderRadius: 1,
          px: 1,
          py: 0,
        }}
        onClick={() => {
          setSubtitlesOpen(!subtitlesOpen);
        }}
      >
        <Stack alignItems='center'>
          <LyricsTextIcon fontSize='small' />
          <Typography
            component='span'
            variant='caption'
            fontSize={10}
            lineHeight={1}
          >
            {t('pages.project.detailsMode.subtitles')}
          </Typography>
        </Stack>
      </IconButton>
    </Tooltip>
  );
};
