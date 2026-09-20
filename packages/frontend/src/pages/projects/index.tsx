import { type FC } from 'react';
import { AppPage } from '../../app/AppPage.js';
import { routes } from '../../app/router/routes.js';
import { ProjectsContent } from './Content.js';
import { CreateDialog } from './dialogs/Create.js';
import { DeleteDialog } from './dialogs/Delete.js';
import { EditDialog } from './dialogs/Edit.js';
import { ProjectsTitle } from './Title.js';

export const ProjectsPage: FC = () => (
  <AppPage>
    <ProjectsTitle />
    <ProjectsContent />
    <routes.projectsCreate.Match component={CreateDialog} />
    <routes.projectsEdit.Match component={EditDialog} />
    <routes.projectsDelete.Match component={DeleteDialog} />
  </AppPage>
);
