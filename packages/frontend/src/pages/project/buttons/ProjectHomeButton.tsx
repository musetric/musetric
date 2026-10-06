import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import { IconButton, Tooltip } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';

export const ProjectHomeButton: FC = () => {
  const { t } = useTranslation();

  return (
    <Tooltip title={t('pages.project.progress.backHome')}>
      <IconButton
        component={routes.home.Link}
        size='small'
        aria-label={t('pages.project.progress.backHome')}
        sx={{ p: 0.5 }}
      >
        <HomeOutlinedIcon fontSize='small' />
      </IconButton>
    </Tooltip>
  );
};
