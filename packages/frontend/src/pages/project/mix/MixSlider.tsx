import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { IconButton, Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playHaptic } from '../haptics.js';
import { TrackLabel } from '../waveform/TrackLabel.js';
import {
  playVolumeTick,
  rememberTrackVolume,
  setTrackVolume,
  toggleTrackMute,
  type TrackVolumeTarget,
  useTrackVolume,
  volumeFullPercent,
  volumeMajorNotchIndex,
  volumeTickEvery,
} from './trackVolume.js';

const notches = Array.from(
  { length: volumeFullPercent / volumeTickEvery - 1 },
  (_, index) => ({ value: (index + 1) * volumeTickEvery }),
);

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
  const volumePercent = Math.round(trackVolume * volumeFullPercent);
  const muted = trackVolume === 0;

  return (
    <Stack sx={{ gap: 0.5 }}>
      <Stack
        direction='row'
        sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}
      >
        <TrackLabel {...target} variant='inline' />
        <Stack direction='row' sx={{ alignItems: 'center', gap: 1 }}>
          <Typography variant='caption' sx={{ color: 'text.secondary' }}>
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
              playHaptic('detent');
              toggleTrackMute(target);
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
        color='primary'
        disabled={realtimeFailed}
        min={0}
        max={volumeFullPercent}
        marks={notches}
        value={volumePercent}
        onPointerDownCapture={() => {
          rememberTrackVolume(target);
        }}
        onChange={(_, value) => {
          playVolumeTick(volumePercent, value);
          setTrackVolume(target, value / volumeFullPercent);
        }}
        sx={{
          height: 4,
          py: '10px',
          '& .MuiSlider-rail': { bgcolor: 'action.selected', opacity: 1 },
          '& .MuiSlider-track': { border: 'none' },
          '& .MuiSlider-mark': {
            width: 2,
            height: 4,
            borderRadius: 0,
            opacity: 1,
            bgcolor: 'background.paper',
            backgroundImage: 'var(--Paper-overlay)',
          },
          [`& .MuiSlider-mark[data-index="${volumeMajorNotchIndex}"]`]: {
            width: 3,
          },
          '& .MuiSlider-thumb': { width: 18, height: 18 },
          '@media (any-pointer: coarse)': { py: '16px' },
        }}
      />
    </Stack>
  );
};
