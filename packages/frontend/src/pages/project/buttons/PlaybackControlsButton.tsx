import MicRoundedIcon from '@mui/icons-material/MicRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { Box, IconButton } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type PlaybackControlsButtonProps = {
  projectId: number;
};

export const PlaybackControlsButton: FC<PlaybackControlsButtonProps> = (
  props,
) => {
  const { projectId } = props;
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const playing = useEngineStore((state) => state.playing);
  const recording = useEngineStore((state) => state.recording);
  const [pendingAction, setPendingAction] = useState(false);
  const active = playing || recording || pendingAction;

  const runAction = async (action: () => void | Promise<void>) => {
    setPendingAction(true);
    try {
      await action();
    } finally {
      setPendingAction(false);
    }
  };

  const getBorderColor = () => {
    if (!frameCount) {
      return 'divider';
    }
    if (recording) {
      return 'error.main';
    }
    return 'text.primary';
  };

  return (
    <Box
      width={82}
      height={34}
      px={0.5}
      display='flex'
      alignItems='center'
      border='1px solid'
      borderRadius={999}
      borderColor={getBorderColor()}
    >
      {!active && (
        <IconButton
          color='error'
          disabled={!frameCount}
          onClick={() => {
            void runAction(async () => {
              await engine.recorder.start(projectId);
            });
          }}
          size='small'
          sx={{
            alignSelf: 'stretch',
            borderBottomRightRadius: 0,
            borderTopRightRadius: 0,
            flex: 1,
          }}
          title={t('pages.project.player.controls.record')}
        >
          <MicRoundedIcon />
        </IconButton>
      )}
      {!active && (
        <Box
          width='1px'
          height={20}
          bgcolor={getBorderColor()}
          flexShrink={0}
        />
      )}
      {!active && (
        <IconButton
          disabled={!frameCount}
          onClick={() => {
            void runAction(engine.player.play);
          }}
          size='small'
          sx={{
            alignSelf: 'stretch',
            borderBottomLeftRadius: 0,
            borderTopLeftRadius: 0,
            flex: 1,
          }}
          title={t('pages.project.player.controls.play')}
        >
          <PlayArrowRoundedIcon />
        </IconButton>
      )}
      {active && (
        <IconButton
          color={recording ? 'error' : undefined}
          disabled={!frameCount}
          onClick={() => {
            void runAction(() => {
              if (engine.recorder.isActive()) {
                void engine.recorder.stop();
                return;
              }
              engine.player.pause();
            });
          }}
          size='small'
          sx={{
            alignSelf: 'stretch',
            borderRadius: 999,
            flex: 1,
            mx: -0.5,
          }}
          title={t('pages.project.player.controls.pause')}
        >
          <PauseRoundedIcon />
        </IconButton>
      )}
    </Box>
  );
};
