import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { useTrackListScroll } from './useTrackListScroll.js';
import { WaveformCanvas } from './WaveformCanvas.js';

export type WaveformListProps = {
  projectId: number;
};

export const WaveformList: FC<WaveformListProps> = (props) => {
  const { projectId } = props;

  const listRef = useTrackListScroll();
  const setTrackListScrollTop = useProjectStore(
    (state) => state.setTrackListScrollTop,
  );

  return (
    <Stack
      ref={listRef}
      gap={1}
      height='100%'
      overflow='auto'
      onScroll={(event) => {
        const { scrollTop } = event.currentTarget;
        setTrackListScrollTop(scrollTop);
      }}
    >
      {stemTypes.map((stemType) => (
        <Box
          key={stemType}
          component={Paper}
          elevation={3}
          height={100}
          flexShrink={0}
        >
          <WaveformCanvas projectId={projectId} stemType={stemType} />
        </Box>
      ))}
    </Stack>
  );
};
