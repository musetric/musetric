import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../app/router/routes.js';
import { ProcessingPause } from './ProcessingPause.js';

export const ProcessingTitle: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack direction='row' justifyContent='space-between' alignItems='center'>
      <Stack direction='row' gap={2} alignItems='center'>
        <IconButton
          component={routes.projects.Link}
          aria-label={t('pages.processing.back')}
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography variant='h4'>{t('pages.processing.title')}</Typography>
      </Stack>
      <ProcessingPause />
    </Stack>
  );
};
