import { Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { type FC, useEffect } from 'react';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';
import { ProjectsContent } from './Content.js';
import { CreateDialog } from './dialogs/Create.js';
import { DeleteDialog } from './dialogs/Delete.js';
import { EditDialog } from './dialogs/Edit.js';
import { ProjectsTitle } from './Title.js';

export const ProjectsPage: FC = () => {
  const queryClient = useQueryClient();
  useEffect(
    () => endpoints.project.subscribeToStatus(queryClient),
    [queryClient],
  );

  return (
    <Stack
      direction='column'
      padding={4}
      gap={4}
      width='100%'
      height='100dvh'
      overflow='auto'
      sx={(theme) => ({
        scrollbarGutter: 'stable',
        paddingTop: `calc(${theme.spacing(4)} + env(safe-area-inset-top, 0px))`,
        paddingBottom: `calc(${theme.spacing(4)} + env(safe-area-inset-bottom, 0px))`,
        paddingLeft: `calc(${theme.spacing(4)} + env(safe-area-inset-left, 0px))`,
        paddingRight: `calc(${theme.spacing(4)} + env(safe-area-inset-right, 0px))`,
      })}
    >
      <ProjectsTitle />
      <ProjectsContent />
      <routes.projectsCreate.Match component={CreateDialog} />
      <routes.projectsEdit.Match component={EditDialog} />
      <routes.projectsDelete.Match component={DeleteDialog} />
    </Stack>
  );
};
