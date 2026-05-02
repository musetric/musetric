import { Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { timelineHeight } from '../visualization/VisualizationTimeline.js';
import { TrackVolumeControl } from './TrackVolumeControl.js';
import { useTrackListScroll } from './useTrackListScroll.js';

export const TrackVolumeList: FC = () => {
  const listRef = useTrackListScroll();

  return (
    <Stack
      ref={listRef}
      gap={1}
      height='100%'
      overflow='auto'
      pb={`${timelineHeight}px`}
    >
      {stemTypes.map((stemType) => (
        <Stack key={stemType} height={100} flexShrink={0}>
          <TrackVolumeControl stemType={stemType} />
        </Stack>
      ))}
    </Stack>
  );
};
