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
  shortScreen: {
    '@media (orientation: landscape) and (max-height: 500px)': {
      gridTemplateAreas: '"header picture" "details picture"',
      gridTemplateRows: 'auto minmax(0, 1fr)',
      gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
    },
  },
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
      : {
          ...getStackedLayout([
            'header',
            ...(detailsOpen ? ['details'] : []),
            ...(spectrogramOpen ? ['picture'] : []),
          ]),
          shortScreen: undefined,
        };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateAreas: layout.areas,
        gridTemplateRows: layout.rows,
        gridTemplateColumns: layout.columns,
        alignContent: 'start',
        columnGap: 2,
        rowGap: { xs: 2, md: 1 },
        mx: -2,
        px: 2,
        flexGrow: 1,
        minHeight: 0,
        overflow: 'hidden',
        ...layout.shortScreen,
      }}
    >
      <ProjectHeader />
      <ProjectDetails />
      {spectrogramOpen && <ProjectSpectrogramVisualization />}
    </Box>
  );
};
