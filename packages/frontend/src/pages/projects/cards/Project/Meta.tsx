import { Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../../api/index.js';
import { formatDuration } from '../../../../common/formatDuration.js';
import { doneCount, stepOrder } from '../../../processing/queue.js';
import { stepTitles } from '../../../processing/stepTitles.js';
import { formatKeyCompact } from '../../../project/key/keyFormat.js';

const getActiveStep = (
  projectInfo: api.project.Item,
): api.project.ProcessingStepName | undefined => {
  const { steps } = projectInfo.processing;
  return (
    stepOrder.find((name) => steps[name].status === 'failed') ??
    stepOrder.find((name) => steps[name].status === 'processing') ??
    stepOrder.find((name) => steps[name].status === 'pending')
  );
};

export type ProjectCardMetaProps = {
  projectInfo: api.project.Item;
};
export const ProjectCardMeta: FC<ProjectCardMetaProps> = (props) => {
  const { projectInfo } = props;
  const { t } = useTranslation();

  const done = !!projectInfo.processing.done;
  const keyQuery = useQuery({
    ...endpoints.key.get(projectInfo.id),
    enabled: done,
  });
  const rhythmQuery = useQuery({
    ...endpoints.rhythm.get(projectInfo.id),
    enabled: done,
  });

  if (!done) {
    const stepName = getActiveStep(projectInfo);
    const count = {
      done: doneCount(projectInfo),
      total: stepOrder.length,
    };
    const stepTitle = stepName ? stepTitles(t)[stepName] : undefined;

    return (
      <Typography variant='caption' color='primary' noWrap>
        {stepTitle
          ? t('pages.projects.cards.processingStep', {
              step: stepTitle,
              ...count,
            })
          : t('pages.processing.steps', count)}
      </Typography>
    );
  }

  const parts = [
    formatDuration(projectInfo.frameCount / projectInfo.sampleRate),
  ];

  if (keyQuery.data) {
    parts.push(formatKeyCompact(keyQuery.data.root, keyQuery.data.mode));
  }
  if (rhythmQuery.data) {
    parts.push(
      t('pages.project.player.controls.tempoValue', {
        value: Math.round(rhythmQuery.data.bpm),
      }),
    );
  }

  return (
    <Typography variant='caption' color='text.secondary' noWrap>
      {parts.join(' · ')}
    </Typography>
  );
};
