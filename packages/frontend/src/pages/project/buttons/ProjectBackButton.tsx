import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';

export const ProjectBackButton: FC = () => {
  const { t } = useTranslation();

  return (
    <Tooltip title={t('pages.project.progress.backHome')}>
      <IconButton
        component={routes.home.Link}
        size='small'
        sx={{ borderRadius: 2, px: 2, py: 1 }}
      >
        <Stack alignItems='center' gap={0.5}>
          <ArrowBackIcon fontSize='small' />
          <Typography variant='caption' lineHeight={1} noWrap>
            {t('pages.project.progress.back')}
          </Typography>
        </Stack>
      </IconButton>
    </Tooltip>
  );
};
