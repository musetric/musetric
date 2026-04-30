import { Box, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useEffect } from 'react';
import { engine } from '../../engine/engine.js';
import { ProjectBackButton } from './buttons/ProjectBackButton.js';
import { VisualizationModeToggle } from './buttons/VisualizationModeToggle.js';
import { PlaybackPanel } from './player/PlaybackPanel.js';
import { ProjectContent } from './ProjectContent.js';
import { ProjectLayout } from './ProjectPageLayout.js';
import { ProjectSettings } from './settings/field/ProjectSettings.js';
import { subscribeSettingsStore } from './settings/store.js';

export type ProjectAppProps = {
  project: api.project.Item;
};
export const ProjectApp: FC<ProjectAppProps> = (props) => {
  const { project } = props;

  useEffect(() => subscribeSettingsStore(), []);

  useEffect(() => engine.decoder.mount(project.id), [project.id]);

  return (
    <ProjectLayout
      heading={
        <>
          <ProjectBackButton />
          <Box flexGrow={1} />
          <ProjectSettings />
          <VisualizationModeToggle />
        </>
      }
    >
      <Stack width='100%' flexGrow={1} minHeight={0} gap={2}>
        <ProjectContent projectId={project.id} />
        <PlaybackPanel />
      </Stack>
    </ProjectLayout>
  );
};
