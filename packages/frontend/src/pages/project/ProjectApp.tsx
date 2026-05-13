import { Alert, Box, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../engine/engine.js';
import { useEngineStore } from '../../engine/useEngineStore.js';
import { ProjectBackButton } from './buttons/ProjectBackButton.js';
import { SubtitlesToggleButton } from './buttons/SubtitlesToggleButton.js';
import { TempoButton } from './buttons/TempoButton.js';
import { TempoPicker } from './buttons/TempoPicker.js';
import { TransposeButton } from './buttons/TransposeButton.js';
import { TransposePicker } from './buttons/TransposePicker.js';
import { ProjectHeaderMenu } from './menu/ProjectHeaderMenu.js';
import { MicrophoneSettings } from './microphone/MicrophoneSettings.js';
import { PlaybackPanel } from './player/PlaybackPanel.js';
import { ProjectContent } from './ProjectContent/index.js';
import { ProjectLayout } from './ProjectPageLayout.js';
import { ProjectSettings } from './settings/field/ProjectSettings.js';
import { subscribeSettingsStore } from './settings/store.js';

export type ProjectAppProps = {
  project: api.project.Item;
};
export const ProjectApp: FC<ProjectAppProps> = (props) => {
  const { project } = props;
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );

  useEffect(() => subscribeSettingsStore(), []);

  useEffect(() => engine.decoder.mount(project.id), [project.id]);

  return (
    <ProjectLayout
      heading={
        <>
          <ProjectBackButton />
          <Box flexGrow={1} />
          <Stack direction='row' gap={1}>
            <SubtitlesToggleButton />
            <TransposeButton />
            <TransposePicker />
            <TempoButton />
            <TempoPicker />
            <ProjectHeaderMenu />
          </Stack>
        </>
      }
    >
      <Stack width='100%' flexGrow={1} minHeight={0} gap={2}>
        {realtimeFailed && (
          <Alert severity='error'>{t('pages.project.realtime.error')}</Alert>
        )}
        <ProjectContent />
        <PlaybackPanel projectId={project.id} />
      </Stack>
      <MicrophoneSettings />
      <ProjectSettings />
    </ProjectLayout>
  );
};
