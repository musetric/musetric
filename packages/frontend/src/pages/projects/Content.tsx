import { Box, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { QueryError } from '../../components/QueryView/QueryError.js';
import { PlaceholderCard } from './cards/Placeholder.js';
import { ProjectCard } from './cards/Project/index.js';
import { ProjectsEmpty } from './Empty.js';

export type ProjectsContentProps = {
  search: string;
};

export const ProjectsContent: FC<ProjectsContentProps> = (props) => {
  const { search } = props;
  const { t } = useTranslation();
  const projectList = useQuery(endpoints.project.list());

  if (projectList.isError) {
    return <QueryError error={projectList.error} />;
  }

  if (projectList.isSuccess && projectList.data.length === 0) {
    return <ProjectsEmpty />;
  }

  const query = search.trim().toLowerCase();
  const visibleProjects = projectList.data?.filter((projectInfo) =>
    projectInfo.name.toLowerCase().includes(query),
  );

  if (visibleProjects?.length === 0) {
    return (
      <Stack alignItems='center' py={10}>
        <Typography color='text.secondary'>
          {t('pages.projects.searchEmpty')}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        display: 'grid',
        gap: 3,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          lg: 'repeat(3, 1fr)',
        },
        alignContent: 'start',
      }}
    >
      {visibleProjects ? (
        <AnimatePresence initial={false}>
          {visibleProjects.map((projectInfo) => (
            <ProjectCard key={projectInfo.id} projectInfo={projectInfo} />
          ))}
        </AnimatePresence>
      ) : (
        Array.from({ length: 6 }).map((_, i) => <PlaceholderCard key={i} />)
      )}
    </Box>
  );
};
