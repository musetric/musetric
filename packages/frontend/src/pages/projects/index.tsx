import { Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { type FC, useEffect, useState } from 'react';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';
import { safeAreaPadding } from '../../app/theme/safeArea.js';
import { ProjectsContent } from './Content.js';
import { CreateDialog } from './dialogs/Create.js';
import { DeleteDialog } from './dialogs/Delete.js';
import { EditDialog } from './dialogs/Edit.js';
import { ProjectsDropZone } from './DropZone.js';
import { ProjectsTitle } from './Title.js';

export const ProjectsPage: FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  useEffect(
    () => endpoints.project.subscribeToStatus(queryClient),
    [queryClient],
  );

  return (
    <ProjectsDropZone>
      <Stack
        direction='column'
        gap={5}
        width='100%'
        height='100dvh'
        overflow='auto'
        sx={(theme) => ({
          scrollbarGutter: 'stable',
          ...safeAreaPadding(theme, 5),
        })}
      >
        <ProjectsTitle search={search} setSearch={setSearch} />
        <ProjectsContent search={search} />
        <routes.projectsCreate.Match component={CreateDialog} />
        <routes.projectsEdit.Match component={EditDialog} />
        <routes.projectsDelete.Match component={DeleteDialog} />
      </Stack>
    </ProjectsDropZone>
  );
};
