import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

export const MixButton: FC = () => {
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const mixChanged = useEngineStore((state) =>
    Object.values(state.trackVolumes).some((volume) => volume !== 1),
  );
  const setMixAnchorEl = useProjectStore((state) => state.setMixAnchorEl);
  const label = t('pages.project.mix.title');

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={realtimeFailed}
          color={mixChanged ? 'primary' : 'inherit'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
          onClick={(event) => {
            setMixAnchorEl(event.currentTarget);
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            <TuneRoundedIcon fontSize='small' />
            <Typography variant='caption' lineHeight={1} noWrap>
              {label}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
