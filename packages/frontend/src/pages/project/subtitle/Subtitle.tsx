import { Skeleton, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { ViewError } from '../../../components/ViewError.js';
import { SubtitleList } from './SubtitleList.js';

export const Subtitle: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
  const subtitleQuery = useQuery(endpoints.subtitle.get(projectId));

  if (subtitleQuery.status === 'pending') {
    return (
      <Stack
        width='100%'
        height='100%'
        alignItems='center'
        justifyContent='center'
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton
            key={index}
            variant='text'
            width={index % 2 === 0 ? '50%' : '35%'}
          />
        ))}
      </Stack>
    );
  }

  if (subtitleQuery.status === 'error') {
    return (
      <Stack
        alignItems='center'
        width='100%'
        height='100%'
        minHeight={0}
        overflow='hidden'
      >
        <ViewError message={t('pages.project.progress.error.lyrics')} />
      </Stack>
    );
  }

  return <SubtitleList subtitle={subtitleQuery.data} />;
};
