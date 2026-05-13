import { IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TransposeIcon } from '../../../icons/TransposeIcon.js';
import { useProjectStore } from '../store.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';

export const TransposeButton: FC = () => {
  const { t } = useTranslation();
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

  return (
    <IconButton
      color={transposeSemitones !== 0 ? 'primary' : 'inherit'}
      disabled={!frameCount || recording || realtimeFailed}
      sx={{
        borderRadius: 1,
        px: 1,
        py: 0,
      }}
      onClick={(event) => {
        setTransposeAnchorEl(event.currentTarget);
      }}
    >
      <Stack alignItems='center'>
        <TransposeIcon fontSize='small' />
        <Typography
          component='span'
          variant='caption'
          fontSize={10}
          lineHeight={1}
        >
          {t('pages.project.player.controls.transposeValue', {
            value: formatTransposeSemitones(transposeSemitones),
          })}
        </Typography>
      </Stack>
    </IconButton>
  );
};
