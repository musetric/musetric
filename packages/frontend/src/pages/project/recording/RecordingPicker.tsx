import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { alpha, Box, Button, Tooltip, Typography } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { useKeepFromGestures } from './useKeepFromGestures.js';

export type RecordingPickerVariant = 'lane' | 'picture';

export type RecordingPickerProps = {
  variant: RecordingPickerVariant;
};

export const RecordingPicker: FC<RecordingPickerProps> = (props) => {
  const { variant } = props;
  const { t } = useTranslation();
  const keepFromGestures = useKeepFromGestures();
  const active = useEngineStore(getActiveRecording);
  const recording = useEngineStore((state) => state.recording);
  const listAnchorEl = useProjectStore((state) => state.recordingListAnchorEl);
  const setListAnchorEl = useProjectStore(
    (state) => state.setRecordingListAnchorEl,
  );

  if (!active) {
    return undefined;
  }

  return (
    <Tooltip
      title={
        recording
          ? t('pages.project.recording.locked')
          : t('pages.project.recording.choose')
      }
    >
      <Box
        ref={keepFromGestures}
        component='span'
        display='inline-flex'
        minWidth={0}
      >
        <Button
          size='small'
          disabled={recording}
          aria-haspopup='menu'
          aria-expanded={listAnchorEl !== undefined}
          endIcon={recording ? undefined : <ExpandMoreRoundedIcon />}
          onClick={(event) => {
            setListAnchorEl(event.currentTarget);
          }}
          sx={(theme) => ({
            ...{
              lane: {
                backgroundColor: theme.palette.background.paper,
                backgroundImage: 'var(--Paper-overlay)',
              },
              picture: {
                backgroundColor: alpha(theme.palette.common.black, 0.8),
              },
            }[variant],
            minWidth: 0,
            maxWidth: 240,
            height: 24,
            px: 0.75,
            borderRadius: 1,
            color: theme.palette.text.primary,
            '& .MuiButton-endIcon': { ml: 0.25 },
            '&.Mui-disabled': { color: theme.palette.error.light },
          })}
        >
          {recording && (
            <Box
              width={6}
              height={6}
              mr={0.75}
              flexShrink={0}
              borderRadius='50%'
              bgcolor='error.main'
            />
          )}
          <Typography variant='caption' fontWeight={600} lineHeight={1} noWrap>
            {recording
              ? t('pages.project.recording.recordingInto', {
                  name: active.name,
                })
              : active.name}
          </Typography>
        </Button>
      </Box>
    </Tooltip>
  );
};
