import { Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Reorder } from 'framer-motion';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { QueryError } from '../../components/QueryView/QueryError.js';
import { ProcessingRow } from './ProcessingRow.js';
import { finished, queued } from './queue.js';

export const ProcessingQueue: FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const projectList = useQuery(endpoints.project.list());
  const order = useMutation(endpoints.processing.order(queryClient));
  const projects = projectList.data ?? [];
  const waiting = queued(projects);

  if (projectList.isError) {
    return <QueryError error={projectList.error} />;
  }

  const done = finished(projects);

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Typography variant='h6'>{t('pages.processing.queue')}</Typography>
        {waiting.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('pages.processing.queueEmpty')}
          </Typography>
        )}
        <Reorder.Group
          axis='y'
          as='div'
          values={waiting}
          onReorder={(reordered: api.project.Item[]) => {
            queryClient.setQueryData(endpoints.project.list().queryKey, () =>
              reordered
                .map((item, index) => ({ ...item, position: index }))
                .concat(done),
            );
            order.mutate({ projectIds: reordered.map((item) => item.id) });
          }}
          style={{ display: 'grid', gap: '8px' }}
        >
          {waiting.map((projectItem) => (
            <Reorder.Item key={projectItem.id} value={projectItem} as='div'>
              <ProcessingRow projectItem={projectItem} draggable />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </Stack>
      {done.length > 0 && (
        <Stack gap={1}>
          <Typography variant='h6'>{t('pages.processing.finished')}</Typography>
          {done.map((projectItem) => (
            <ProcessingRow
              key={projectItem.id}
              projectItem={projectItem}
              draggable={false}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};
