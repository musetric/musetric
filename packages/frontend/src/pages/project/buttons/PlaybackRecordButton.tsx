import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { Badge, Box, IconButton, Tooltip } from '@mui/material';
import { getActiveRecording, getCalibrationNeeded } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { requestTake } from '../calibration/takeActions.js';
import { getBeatsToFrom } from '../loop/loopCountdown.js';

export const PlaybackRecordButton: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const isSlave = useEngineStore((state) => state.isSlave);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const recording = useEngineStore((state) => state.recording);
  const stage = useEngineStore((state) => state.loopStage);
  const looping = stage !== undefined;
  const phase = useEngineStore((state) => state.loopTryPhase);
  const beats = useEngineStore((state) =>
    state.loopTryPhase === 'armed'
      ? getBeatsToFrom(state, engine.context.sampleRate)
      : undefined,
  );
  const calibrationNeeded = useEngineStore(getCalibrationNeeded);
  const recordingName = useEngineStore(
    (state) => getActiveRecording(state)?.name,
  );
  const disabled =
    !frameCount ||
    recordingName === undefined ||
    realtimeFailed ||
    isSlave ||
    playerCommandPending;

  const getTitle = () => {
    if (looping) {
      return phase
        ? t('pages.project.loop.cancelTry')
        : t('pages.project.loop.recordTry');
    }
    return recording
      ? t('pages.project.player.controls.stopRecording')
      : t('pages.project.player.controls.record', { name: recordingName });
  };
  const title = getTitle();
  const pressed = looping ? phase !== undefined : recording;
  const writing = recording && phase !== 'armed';
  const calibrationHint =
    calibrationNeeded && !pressed
      ? t('pages.project.calibration.recordHint')
      : undefined;

  return (
    <Tooltip
      enterTouchDelay={0}
      title={
        calibrationHint ? (
          <Box
            component='span'
            sx={{ display: 'flex', flexDirection: 'column' }}
          >
            <span>{title}</span>
            <span>{calibrationHint}</span>
          </Box>
        ) : (
          title
        )
      }
    >
      <Box
        component='span'
        sx={{ flex: 1, alignSelf: 'stretch', display: 'flex', ml: -1 }}
      >
        <IconButton
          aria-label={calibrationHint ? `${title}. ${calibrationHint}` : title}
          aria-pressed={pressed}
          color={writing ? 'inherit' : 'error'}
          disabled={disabled}
          onClick={() => {
            if (looping) {
              if (phase) {
                void engine.player.cancelTry();
                return;
              }
              requestTake('recordTry', projectId);
              return;
            }
            if (recording) {
              void engine.player.stopRecording();
              return;
            }
            requestTake('record', projectId);
          }}
          sx={{ borderRadius: '999px 0 0 999px', flex: 1 }}
        >
          {phase === 'armed' ? (
            <Badge
              badgeContent={beats}
              color='error'
              invisible={beats === undefined}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: 2,
                  borderColor: 'error.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MicRoundedIcon fontSize='small' />
              </Box>
            </Badge>
          ) : (
            <Badge
              variant='dot'
              color='warning'
              invisible={calibrationHint === undefined}
            >
              <MicRoundedIcon />
            </Badge>
          )}
        </IconButton>
      </Box>
    </Tooltip>
  );
};
