import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getProcessingProgress,
  processingStepOrder,
} from '../../../common/processingStep.js';
import { ProjectLayout } from '../ProjectPageLayout.js';
import { FlowStep } from './Step/FlowStep.js';
import { useProcessingEta } from './useProcessingEta.js';

export type ProjectProgressFlowProps = {
  project: api.project.Item;
};

export const ProjectProgressFlow: FC<ProjectProgressFlowProps> = (props) => {
  const { project } = props;

  const { t } = useTranslation();
  const progress = getProcessingProgress(project.processing);
  const percent = Math.round(progress * 100);
  const eta = useProcessingEta(project.id, progress);

  return (
    <ProjectLayout title={project.name}>
      <Box
        width='100%'
        display='flex'
        alignItems='center'
        justifyContent='center'
        flex={1}
      >
        <Stack width='100%' maxWidth='34rem' gap={6}>
          <Stack gap={2}>
            <Stack
              direction='row'
              justifyContent='space-between'
              alignItems='baseline'
              gap={3}
            >
              <Typography variant='h5'>
                {t('pages.project.progress.trackTitle')}
              </Typography>
              <Typography variant='h5' color='primary'>
                {`${percent}%`}
              </Typography>
            </Stack>
            <LinearProgress variant='determinate' value={percent} />
            <Stack
              direction='row'
              justifyContent='space-between'
              gap={3}
              color='text.secondary'
            >
              <Typography variant='caption'>
                {t('pages.project.progress.background')}
              </Typography>
              {eta && (
                <Typography variant='caption'>
                  {t('pages.project.progress.remaining', { duration: eta })}
                </Typography>
              )}
            </Stack>
          </Stack>
          <Stack gap={3}>
            {processingStepOrder.map((stepKey) => (
              <FlowStep
                key={stepKey}
                projectId={project.id}
                stepKey={stepKey}
                step={project.processing.steps[stepKey]}
              />
            ))}
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
