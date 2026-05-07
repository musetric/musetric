import { Paper, Slider, Stack, Typography } from '@mui/material';
import { type StemType } from '@musetric/audio';
import { type FC } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TrackStemLabel } from './TrackStemLabel.js';

export type TrackVolumeControlProps = {
  stemType: StemType;
};

export const TrackVolumeControl: FC<TrackVolumeControlProps> = (props) => {
  const { stemType } = props;
  const trackVolume = useEngineStore((state) => state.trackVolumes[stemType]);
  const volumePercent = Math.round(trackVolume * 100);

  return (
    <Stack
      component={Paper}
      elevation={3}
      height='100%'
      justifyContent='center'
      p={2.5}
      position='relative'
    >
      <TrackStemLabel stemType={stemType} />
      <Stack direction='row' alignItems='center' gap={3}>
        <Slider
          size='small'
          min={0}
          max={100}
          value={volumePercent}
          onChange={(_, value) => {
            engine.store.update((state) => {
              state.trackVolumes[stemType] = value / 100;
            });
          }}
        />
        <Typography variant='caption' minWidth='4ch' textAlign='right'>
          {`${volumePercent}%`}
        </Typography>
      </Stack>
    </Stack>
  );
};
