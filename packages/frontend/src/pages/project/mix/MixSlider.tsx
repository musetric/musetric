import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { IconButton, Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TrackLabel } from '../waveform/TrackLabel.js';
import {
  setTrackVolume,
  type TrackVolumeTarget,
  useTrackVolume,
} from './trackVolume.js';

export type MixSliderProps = {
  target: TrackVolumeTarget;
};

export const MixSlider: FC<MixSliderProps> = (props) => {
  const { target } = props;
  const { t } = useTranslation();
  const trackVolume = useTrackVolume(target);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const volumePercent = Math.round(trackVolume * 100);
  const muted = trackVolume === 0;

  return (
    <Stack gap={0.5}>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        gap={2}
      >
        <TrackLabel {...target} variant='inline' />
        <Stack direction='row' alignItems='center' gap={1}>
          <Typography variant='caption' color='text.secondary'>
            {`${volumePercent}%`}
          </Typography>
          <IconButton
            size='small'
            disabled={realtimeFailed}
            color={muted ? 'primary' : 'default'}
            aria-label={
              muted
                ? t('pages.project.mix.unmute')
                : t('pages.project.mix.mute')
            }
            onClick={() => {
              setTrackVolume(target, muted ? 1 : 0);
            }}
          >
            {muted ? (
              <VolumeOffRoundedIcon fontSize='small' />
            ) : (
              <VolumeUpRoundedIcon fontSize='small' />
            )}
          </IconButton>
        </Stack>
      </Stack>
      <Slider
        size='small'
        disabled={realtimeFailed}
        min={0}
        max={100}
        value={volumePercent}
        onChange={(_, value) => {
          setTrackVolume(target, value / 100);
        }}
      />
    </Stack>
  );
};
