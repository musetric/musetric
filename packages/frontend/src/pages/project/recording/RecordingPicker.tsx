import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { alpha, Box, Button, Tooltip, Typography } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import {
  pictureLabelHeight,
  pictureLabelMaxWidth,
  pictureLabelMinWidth,
} from '../visualization/pictureLabel.js';
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
        sx={{ display: 'inline-flex', minWidth: 0 }}
      >
        <Button
          size='small'
          disabled={recording}
          aria-label={
            variant === 'lane' ? t('pages.project.recording.choose') : undefined
          }
          aria-haspopup='menu'
          aria-expanded={listAnchorEl !== undefined}
          endIcon={recording ? undefined : <ExpandMoreRoundedIcon />}
          onClick={(event) => {
            setListAnchorEl(event.currentTarget);
          }}
          sx={(theme) => ({
            ...{
              lane: {
                minWidth: 0,
                width: 24,
                height: '100%',
                '& .MuiButton-endIcon': { m: 0 },
              },
              picture: {
                backgroundColor: alpha(theme.palette.common.black, 0.8),
                minWidth: pictureLabelMinWidth,
                maxWidth: pictureLabelMaxWidth,
                height: pictureLabelHeight,
                justifyContent: 'flex-start',
                '& .MuiButton-endIcon': { ml: 'auto', pl: 0.25 },
              },
            }[variant],
            px: 0.75,
            borderRadius: 1,
            color: theme.palette.text.primary,
            '&.Mui-disabled': { color: theme.palette.error.light },
            '@media (any-pointer: coarse)': {
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: '-10px 0',
              },
            },
          })}
        >
          {recording && (
            <Box
              sx={{
                width: 6,
                height: 6,
                mr: 0.75,
                flexShrink: 0,
                borderRadius: '50%',
                bgcolor: 'error.main',
              }}
            />
          )}
          {variant === 'picture' && (
            <Typography
              variant='caption'
              noWrap
              sx={{ fontWeight: 600, lineHeight: 1 }}
            >
              {recording
                ? t('pages.project.recording.recordingInto', {
                    name: active.name,
                  })
                : active.name}
            </Typography>
          )}
        </Button>
      </Box>
    </Tooltip>
  );
};
