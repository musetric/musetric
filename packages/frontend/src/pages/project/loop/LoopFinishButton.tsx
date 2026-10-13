import { Box, Button, Tooltip } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { closeLoop } from './loopActions.js';
import { formatLoopTime } from './loopRange.js';

const buttonSx = {
  minWidth: 0,
  maxWidth: '100%',
  borderRadius: 4,
  px: 4,
  whiteSpace: 'nowrap',
} as const;

const labelSx = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

export type LoopFinishButtonProps = {
  busy: boolean;
  onKeepTry: () => void;
  onKeepOriginal: () => void;
};

export const LoopFinishButton: FC<LoopFinishButtonProps> = (props) => {
  const { busy, onKeepTry, onKeepOriginal } = props;
  const { t } = useTranslation();
  const range = useEngineStore((state) => state.range);
  const hasTries = useEngineStore((state) => state.loopTries.length > 0);
  const tryNumber = useEngineStore(
    (state) =>
      state.loopTries.find((item) => item.id === state.loopSelectedTryId)
        ?.number,
  );
  const recording = useEngineStore((state) => getActiveRecording(state)?.name);

  if (!hasTries || !range) {
    return (
      <Button size='small' color='inherit' onClick={closeLoop} sx={buttonSx}>
        {t('pages.project.loop.close')}
      </Button>
    );
  }

  const { sampleRate } = engine.context;
  const name =
    tryNumber === undefined
      ? undefined
      : t('pages.project.loop.try', { number: tryNumber });
  const label =
    name === undefined
      ? t('pages.project.loop.keepOriginal')
      : t('pages.project.loop.keepTry', { name, recording });
  const hint =
    name === undefined
      ? t('pages.project.loop.keepOriginalHint')
      : t('pages.project.loop.keepTryHint', {
          name,
          recording,
          from: formatLoopTime(range.fromFrame / sampleRate),
          to: formatLoopTime(range.toFrame / sampleRate),
        });

  return (
    <Tooltip title={hint}>
      <Box component='span' sx={{ display: 'inline-flex', minWidth: 0 }}>
        <Button
          size='small'
          variant='contained'
          disabled={busy}
          onClick={name === undefined ? onKeepOriginal : onKeepTry}
          sx={buttonSx}
        >
          <Box component='span' sx={labelSx}>
            {label}
          </Box>
        </Button>
      </Box>
    </Tooltip>
  );
};
