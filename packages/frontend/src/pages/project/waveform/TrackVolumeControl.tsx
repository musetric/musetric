import { Paper, Slider, Stack, Typography } from '@mui/material';
import { type StemType } from '@musetric/audio';
import { type FC } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TrackLabel } from './TrackLabel.js';

export type TrackVolumeControlProps =
  | {
      kind: 'delivery';
      stemType: StemType;
    }
  | {
      kind: 'recording';
    };

export const TrackVolumeControl: FC<TrackVolumeControlProps> = (props) => {
  const trackVolume = useEngineStore((state) =>
    props.kind === 'recording'
      ? state.trackVolumes.recording
      : state.trackVolumes[props.stemType],
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const volumePercent = Math.round(trackVolume * 100);

  return (
    <Stack
      component={Paper}
      elevation={3}
      height='100%'
      justifyContent='center'
      p={2.5}
      position='relative'
      sx={{ userSelect: 'none' }}
    >
      <TrackLabel {...props} />
      <Stack direction='row' alignItems='center' gap={3}>
        <Slider
          size='small'
          disabled={realtimeFailed}
          min={0}
          max={100}
          value={volumePercent}
          onChange={(_, value) => {
            engine.store.update((state) => {
              if (props.kind === 'recording') {
                state.trackVolumes.recording = value / 100;
                return;
              }
              state.trackVolumes[props.stemType] = value / 100;
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
