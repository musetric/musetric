import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import { Box, Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ProcessingPause } from '../../processing/ProcessingPause.js';
import { doneCount, stepOrder } from '../../processing/queue.js';
import { stepTitles } from '../../processing/stepTitles.js';
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
          <Typography variant='h6' noWrap sx={{ flexGrow: 1 }}>
            {project.name}
          </Typography>
          <Stack direction='row' sx={{ alignItems: 'center', gap: 1 }}>
            <FlowPause projectId={project.id} paused={project.paused} />
            <ProcessingPause />
          </Stack>
        </>
      }
    >
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Stack sx={{ width: '100%', maxWidth: '34rem', gap: 6, my: 'auto' }}>
          <Stack sx={{ gap: 1 }}>
            <Stack
              direction='row'
              sx={{
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 3,
              }}
            >
              <Typography variant='h5'>
                {t('pages.project.progress.trackTitle')}
              </Typography>
              <Typography variant='subtitle1' sx={{ color: 'text.secondary' }}>
                {t('pages.processing.steps', {
                  done: doneCount(project),
                  total: stepOrder.length,
                })}
              </Typography>
            </Stack>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {t('pages.project.progress.background')}
            </Typography>
          </Stack>
          <Stack sx={{ gap: 3 }}>
            {stepOrder.map((stepName) => (
              <FlowStep
                key={stepName}
                projectId={project.id}
                stepName={stepName}
                title={stepTitles(t)[stepName]}
                step={project.processing.steps[stepName]}
              />
            ))}
          </Stack>
          <Stack direction='row' sx={{ gap: 2, alignItems: 'center' }}>
            <MemoryOutlinedIcon
              fontSize='small'
              sx={{ color: 'text.disabled' }}
            />
            <Typography variant='caption' sx={{ color: 'text.disabled' }}>
              {t('pages.project.progress.local')}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </ProjectLayout>
  );
};
