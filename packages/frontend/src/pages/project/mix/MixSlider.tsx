import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { IconButton, Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playCrossedTick, playHaptic } from '../haptics.js';
import { TrackLabel } from '../waveform/TrackLabel.js';
import {
  setTrackVolume,
  type TrackVolumeTarget,
  useTrackVolume,
} from './trackVolume.js';

const fullPercent = 100;
const tickEvery = 10;
const majorTickEvery = 50;
const notches = Array.from(
  { length: fullPercent / tickEvery - 1 },
  (_, index) => ({ value: (index + 1) * tickEvery }),
);
const majorNotchIndex = majorTickEvery / tickEvery - 1;

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
  const volumePercent = Math.round(trackVolume * fullPercent);
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
        color='primary'
        disabled={realtimeFailed}
        min={0}
        max={fullPercent}
        marks={notches}
        value={volumePercent}
        onChange={(_, value) => {
          playCrossedTick(
            volumePercent,
            value,
            tickEvery,
            (tick) => tick % majorTickEvery === 0,
          );
          setTrackVolume(target, value / fullPercent);
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
          [`& .MuiSlider-mark[data-index="${majorNotchIndex}"]`]: { width: 3 },
          '& .MuiSlider-thumb': { width: 18, height: 18 },
          '@media (any-pointer: coarse)': { py: '16px' },
        }}
      />
    </Stack>
  );
};
