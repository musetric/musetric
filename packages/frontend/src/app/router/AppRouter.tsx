import { FirstMatch, useSyncHistoryLocation } from '@musetric/spa-router';
import { type FC } from 'react';
import { NotFoundPage } from '../../pages/notFound/index.js';
import { ProcessingPage } from '../../pages/processing/index.js';
import { ProjectPage } from '../../pages/project/index.js';
import { ProjectsPage } from '../../pages/projects/index.js';
import { routes } from './routes.js';

export const AppRouter: FC = () => {
  useSyncHistoryLocation();
  return (
    <FirstMatch>
      <routes.home.Match component={ProjectsPage} />
      <routes.projects.Match component={ProjectsPage} />
      <routes.processing.Match component={ProcessingPage} />
      <routes.project.Match component={ProjectPage} />
      <routes.any.Match component={NotFoundPage} />
    </FirstMatch>
  );
};
