import { Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
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
  const trackVolume = useTrackVolume(target);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const volumePercent = Math.round(trackVolume * 100);

  return (
    <Stack gap={0.5}>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='baseline'
      >
        <TrackLabel {...target} variant='inline' />
        <Typography variant='caption' color='text.secondary'>
          {`${volumePercent}%`}
        </Typography>
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
