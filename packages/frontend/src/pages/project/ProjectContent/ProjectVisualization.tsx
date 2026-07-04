import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { ProjectSpectrogramVisualization } from './ProjectSpectrogramVisualization.js';
import { ProjectTracksVisualization } from './ProjectTracksVisualization.js';

export const ProjectVisualization: FC = () => {
  const visualizationMode = useProjectStore((state) => state.visualizationMode);

  if (visualizationMode === 'tracks') {
    return <ProjectTracksVisualization />;
  }

  return <ProjectSpectrogramVisualization />;
};
