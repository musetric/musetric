import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { Badge, Box, IconButton, Tooltip } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { getActiveRecording, getCalibrationNeeded } from '@musetric/engine';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { canPressRecord, pressRecord } from '../calibration/takeActions.js';
import { getBeatsToFrom } from '../loop/loopCountdown.js';
import { RecordMenu } from './RecordMenu.js';
import { useLongPress } from './useLongPress.js';

const holdRingLength = 132;

const holdRing = keyframes`
  to {
    stroke-dashoffset: 0;
  }
`;

export const PlaybackRecordButton: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
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
  const disabled = !useEngineStore(canPressRecord);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement>();
  const longPress = useLongPress(setMenuAnchor);

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
  const holdHint = pressed ? undefined : t('pages.project.recordMenu.hint');
  const hints = [calibrationHint, holdHint].filter(
    (hint) => hint !== undefined,
  );

  return (
    <>
      <Tooltip
        enterTouchDelay={0}
        title={
          menuAnchor || longPress.holding ? (
            ''
          ) : (
            <Box
              component='span'
              sx={{ display: 'flex', flexDirection: 'column' }}
            >
              <span>{title}</span>
              {hints.map((hint) => (
                <span key={hint}>{hint}</span>
              ))}
            </Box>
          )
        }
      >
        <Box
          component='span'
          sx={{ flex: 1, alignSelf: 'stretch', display: 'flex', ml: -1 }}
        >
          <IconButton
            aria-label={[title, ...hints].join('. ')}
            aria-pressed={pressed}
            aria-haspopup='menu'
            color={writing ? 'inherit' : 'error'}
            disabled={disabled}
            {...longPress.handlers}
            onClick={() => {
              pressRecord(projectId);
            }}
            sx={{
              borderRadius: '999px 0 0 999px',
              flex: 1,
              position: 'relative',
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
          >
            {longPress.holding && (
              <Box
                component='svg'
                viewBox='0 0 48 48'
                aria-hidden
                sx={{
                  position: 'absolute',
                  width: 48,
                  height: 48,
                  transform: 'rotate(-90deg)',
                  pointerEvents: 'none',
                  '& circle': {
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 3,
                    strokeDasharray: holdRingLength,
                    strokeDashoffset: holdRingLength,
                    animation: `${holdRing} 500ms linear forwards`,
                  },
                }}
              >
                <circle cx='24' cy='24' r='21' />
              </Box>
            )}
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
      <RecordMenu
        anchorEl={menuAnchor}
        onClose={() => {
          setMenuAnchor(undefined);
        }}
      />
    </>
  );
};
