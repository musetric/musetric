import { Box, Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectLayout } from '../ProjectPageLayout.js';
import { FlowStep } from './Step/FlowStep.js';

export type ProjectProgressFlowProps = {
  project: api.project.Item;
};

export const ProjectProgressFlow: FC<ProjectProgressFlowProps> = (props) => {
  const { project } = props;

  const { t } = useTranslation();

  return (
    <ProjectLayout>
      <Box
        width='100%'
        display='flex'
        alignItems='center'
        justifyContent='center'
        p={4}
        flex={1}
      >
        <Stack width='100%' maxWidth='48rem' position='relative' gap={3}>
          <Typography variant='h4' fontWeight='bold'>
            {t('pages.project.progress.trackTitle')}
          </Typography>
          <Stack gap={2}>
            <FlowStep
              title={t('pages.project.progress.steps.separation')}
              step={project.processing.steps.separation}
            />
            <FlowStep
              title={t('pages.project.progress.steps.transcription')}
              step={project.processing.steps.transcription}
            />
          </Stack>
        </Stack>
      </Box>
    </ProjectLayout>
  );
};
