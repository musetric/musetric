import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { closeLoop, lockLoop, openLoop } from './loopActions.js';
import { getLoopAtTime } from './loopRange.js';

const plateSx = {
  display: 'flex',
  borderRadius: 1,
  bgcolor: 'background.default',
} as const;

export const LoopPictureControls: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
  const subtitleQuery = useQuery(endpoints.subtitle.get(projectId));
  const stage = useEngineStore((state) => state.loopStage);
  const available = useEngineStore(
    (state) =>
      Boolean(state.frameCount) &&
      !state.isSlave &&
      state.statuses.realtime !== 'error',
  );

  if (stage === 'sing' || !available) {
    return undefined;
  }

  const enter = () => {
    const state = engine.store.get();
    const { sampleRate } = engine.context;
    openLoop(
      getLoopAtTime(subtitleQuery.data ?? [], state.frameIndex / sampleRate, {
        ...state,
        sampleRate,
      }),
    );
  };

  return (
    <Stack direction='row' sx={{ gap: 1 }}>
      {stage === undefined ? (
        <Tooltip title={t('pages.project.loop.enter')}>
          <Box sx={{ ...plateSx, borderRadius: 2 }}>
            <IconButton
              size='small'
              color='inherit'
              aria-label={t('pages.project.loop.enter')}
              onClick={enter}
              sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
            >
              <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
                <RepeatRoundedIcon fontSize='small' />
                <Typography variant='caption' noWrap sx={{ lineHeight: 1 }}>
                  {t('pages.project.loop.caption')}
                </Typography>
              </Stack>
            </IconButton>
          </Box>
        </Tooltip>
      ) : (
        <>
          <Button
            size='small'
            variant='contained'
            onClick={lockLoop}
            sx={{ borderRadius: 1, textTransform: 'none' }}
          >
            {t('pages.project.loop.applyRange')}
          </Button>
          <Tooltip title={t('pages.project.loop.closeRange')}>
            <Box sx={plateSx}>
              <IconButton
                size='small'
                aria-label={t('pages.project.loop.closeRange')}
                onClick={closeLoop}
                sx={{ borderRadius: 1 }}
              >
                <CloseRoundedIcon fontSize='small' />
              </IconButton>
            </Box>
          </Tooltip>
        </>
      )}
    </Stack>
  );
};
