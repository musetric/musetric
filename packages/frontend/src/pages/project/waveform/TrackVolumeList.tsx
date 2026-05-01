import { Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { TrackVolumeControl } from './TrackVolumeControl.js';

export const TrackVolumeList: FC = () => {
  return (
    <Stack gap={1} height='100%' overflow='auto'>
      {stemTypes.map((stemType) => (
        <Stack key={stemType} height={100} flexShrink={0}>
          <TrackVolumeControl stemType={stemType} />
        </Stack>
      ))}
    </Stack>
  );
};
