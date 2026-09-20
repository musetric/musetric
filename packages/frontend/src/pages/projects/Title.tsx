import AddIcon from '@mui/icons-material/Add';
import { Button, CardMedia, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../app/router/routes.js';
import favicon from '../../favicon.svg';
import { ProcessingIndicator } from '../processing/ProcessingIndicator.js';

export const ProjectsTitle: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack direction='row' justifyContent='space-between'>
      <Stack direction='row' gap={2} alignItems='center'>
        <CardMedia
          component='img'
          image={favicon}
          sx={{
            width: '36px',
            height: '36px',
          }}
        />
        <Typography variant='h4'>{t('pages.projects.title')}</Typography>
      </Stack>
      <Stack direction='row' gap={2} alignItems='center'>
        <ProcessingIndicator />
        <Button
          component={routes.projectsCreate.Link}
          variant='outlined'
          startIcon={<AddIcon fontSize='inherit' />}
        >
          {t('pages.projects.create')}
        </Button>
      </Stack>
    </Stack>
  );
};
