import { Box } from '@mui/material';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { ProjectDetails } from './ProjectDetails.js';
import { ProjectHeader } from './ProjectHeader.js';
import { ProjectSpectrogramVisualization } from './ProjectSpectrogramVisualization.js';

const sideBySideLayout = {
  areas: {
    xs: '"header" "details" "picture"',
    md: '"header picture" "details picture"',
  },
  rows: {
    xs: 'auto minmax(0, 1fr) minmax(0, 2fr)',
    md: 'auto minmax(0, 1fr)',
  },
  columns: { xs: 'minmax(0, 1fr)', md: '420px minmax(0, 1fr)' },
};

const getStackedLayout = (areas: string[]) => ({
  areas: areas.map((area) => `"${area}"`).join(' '),
  rows: areas
    .map((area) => (area === 'header' ? 'auto' : 'minmax(0, 1fr)'))
    .join(' '),
  columns: 'minmax(0, 1fr)',
});

export const ProjectContent: FC = () => {
  const detailsOpen = useProjectStore((state) => !!state.detailsView);
  const spectrogramOpen = useProjectStore((state) => state.spectrogramOpen);
  const layout =
    detailsOpen && spectrogramOpen
      ? sideBySideLayout
      : getStackedLayout([
          'header',
          ...(detailsOpen ? ['details'] : []),
          ...(spectrogramOpen ? ['picture'] : []),
        ]);

  return (
    <Box
      display='grid'
      gridTemplateAreas={layout.areas}
      gridTemplateRows={layout.rows}
      gridTemplateColumns={layout.columns}
      alignContent='start'
      columnGap={2}
      rowGap={{ xs: 2, md: 1 }}
      width='100%'
      flexGrow={1}
      minHeight={0}
      overflow='hidden'
    >
      <ProjectHeader />
      <ProjectDetails />
      {spectrogramOpen && <ProjectSpectrogramVisualization />}
    </Box>
  );
};
