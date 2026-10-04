import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TransposeIcon } from '../../../icons/TransposeIcon.js';
import { formatKeyCompact, transposeKeyRoot } from '../key/keyFormat.js';
import { useProjectStore } from '../store.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';

export const TransposeButton: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const setTransposeAnchorEl = useProjectStore(
    (state) => state.setTransposeAnchorEl,
  );
  const keyQuery = useQuery(endpoints.key.get(projectId));
  const label = t('pages.project.player.controls.transpose');

  const value =
    keyQuery.status === 'success'
      ? formatKeyCompact(
          transposeKeyRoot(keyQuery.data.root, transposeSemitones),
          keyQuery.data.mode,
        )
      : t('pages.project.player.controls.transposeValue', {
          value: formatTransposeSemitones(transposeSemitones),
        });

  return (
    <Tooltip title={label}>
      <Box>
        <IconButton
          size='small'
          disabled={!frameCount || recording || realtimeFailed}
          color={transposeSemitones === 0 ? 'inherit' : 'primary'}
          aria-label={label}
          sx={{ borderRadius: 2, px: 2, py: 1 }}
          onClick={(event) => {
            setTransposeAnchorEl(event.currentTarget);
          }}
        >
          <Stack alignItems='center' gap={0.5}>
            <TransposeIcon fontSize='small' />
            <Typography variant='caption' lineHeight={1} noWrap>
              {value}
            </Typography>
          </Stack>
        </IconButton>
      </Box>
    </Tooltip>
  );
};
