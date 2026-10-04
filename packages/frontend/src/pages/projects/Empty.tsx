import LibraryMusicOutlinedIcon from '@mui/icons-material/LibraryMusicOutlined';
import { Button, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../app/router/routes.js';

export const ProjectsEmpty: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack
      alignItems='center'
      justifyContent='center'
      flexGrow={1}
      gap={4}
      py={12}
    >
      <LibraryMusicOutlinedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
      <Stack alignItems='center' gap={2} maxWidth={420}>
        <Typography variant='h5'>{t('pages.projects.empty.title')}</Typography>
        <Typography color='text.secondary' textAlign='center'>
          {t('pages.projects.empty.description')}
        </Typography>
      </Stack>
      <Button
        component={routes.projectsCreate.Link}
        variant='contained'
        color='primary'
        size='large'
      >
        {t('pages.projects.empty.action')}
      </Button>
    </Stack>
  );
};
