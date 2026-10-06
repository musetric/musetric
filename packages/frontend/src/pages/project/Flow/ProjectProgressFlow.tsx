import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import { Box, Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ProcessingPause } from '../../processing/ProcessingPause.js';
import { doneCount, stepOrder } from '../../processing/queue.js';
import { ProjectHomeButton } from '../buttons/ProjectHomeButton.js';
import { ProjectLayout } from '../ProjectPageLayout.js';
import { FlowPause } from './FlowPause.js';
import { FlowStep } from './Step/FlowStep.js';

export type ProjectProgressFlowProps = {
  project: api.project.Item;
};

export const ProjectProgressFlow: FC<ProjectProgressFlowProps> = (props) => {
  const { project } = props;

  const { t } = useTranslation();

  return (
    <ProjectLayout
      heading={
        <>
          <ProjectHomeButton />
          <Typography variant='h6' noWrap flexGrow={1}>
            {project.name}
          </Typography>
          <Stack direction='row' alignItems='center' gap={1}>
            <FlowPause projectId={project.id} paused={project.paused} />
            <ProcessingPause />
          </Stack>
        </>
      }
    >
      <Box
        width='100%'
        display='flex'
        justifyContent='center'
        flex={1}
        overflow='auto'
      >
        <Stack width='100%' maxWidth='34rem' gap={6} my='auto'>
          <Stack gap={1}>
            <Stack
              direction='row'
              justifyContent='space-between'
              alignItems='baseline'
              gap={3}
            >
              <Typography variant='h5'>
                {t('pages.project.progress.trackTitle')}
              </Typography>
              <Typography variant='subtitle1' color='text.secondary'>
                {t('pages.processing.steps', {
                  done: doneCount(project),
                  total: stepOrder.length,
                })}
              </Typography>
            </Stack>
            <Typography variant='caption' color='text.secondary'>
              {t('pages.project.progress.background')}
            </Typography>
          </Stack>
          <Stack gap={3}>
            <FlowStep
              projectId={project.id}
              stepName='separation'
              title={t('pages.project.progress.steps.separation')}
              step={project.processing.steps.separation}
            />
            <FlowStep
              projectId={project.id}
              stepName='voices'
              title={t('pages.project.progress.steps.voices')}
              step={project.processing.steps.voices}
            />
            <FlowStep
              projectId={project.id}
              stepName='transcription'
              title={t('pages.project.progress.steps.transcription')}
              step={project.processing.steps.transcription}
            />
            <FlowStep
              projectId={project.id}
              stepName='rhythm'
              title={t('pages.project.progress.steps.rhythm')}
              step={project.processing.steps.rhythm}
            />
            <FlowStep
              projectId={project.id}
              stepName='key'
              title={t('pages.project.progress.steps.key')}
              step={project.processing.steps.key}
            />
            <FlowStep
              projectId={project.id}
              stepName='chords'
              title={t('pages.project.progress.steps.chords')}
              step={project.processing.steps.chords}
            />
          </Stack>
          <Stack direction='row' gap={2} alignItems='center'>
            <MemoryOutlinedIcon
              fontSize='small'
              sx={{ color: 'text.disabled' }}
            />
            <Typography variant='caption' color='text.disabled'>
              {t('pages.project.progress.local')}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </ProjectLayout>
  );
};
