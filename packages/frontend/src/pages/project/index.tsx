import { apiError } from '@musetric/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';
import { ViewError } from '../../components/ViewError.js';
import { ViewPending } from '../../components/ViewPending.js';
import { ProjectProgressFlow } from './Flow/ProjectProgressFlow.js';
import { ProjectApp } from './ProjectApp.js';
import { ProjectLayout } from './ProjectPageLayout.js';
import { useThemeSpectrogramColors } from './settings/theme.js';

export const ProjectPage: FC = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  useThemeSpectrogramColors();

  const { projectId } = routes.project.useAssertMatch();

  const project = useQuery(endpoints.project.get(projectId));
  useEffect(
    () => endpoints.project.subscribeToStatus(queryClient),
    [queryClient],
  );

  if (project.status === 'error') {
    const errorMessage = apiError.getMessage(project.error);

    return (
      <ProjectLayout>
        <ViewError
          message={errorMessage ?? t('pages.project.progress.error.project')}
        />
      </ProjectLayout>
    );
  }

  if (project.status === 'pending') {
    return (
      <ProjectLayout>
        <ViewPending message={t('pages.project.progress.loading')} />
      </ProjectLayout>
    );
  }

  if (!project.data.processing.done) {
    return <ProjectProgressFlow project={project.data} />;
  }

  return <ProjectApp project={project.data} />;
};
