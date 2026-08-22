import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { IconButton, Tooltip } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { ControlButtonContent } from './ControlButtonContent.js';
import { controlButtonSx } from './controlButtonSx.js';

export const ProjectBackButton: FC = () => {
  const { t } = useTranslation();

  return (
    <Tooltip title={t('pages.project.progress.backHome')}>
      <IconButton
        component={routes.home.Link}
        size='small'
        sx={controlButtonSx}
      >
        <ControlButtonContent
          icon={<ArrowBackIcon fontSize='small' />}
          caption={t('pages.project.back')}
        />
      </IconButton>
    </Tooltip>
  );
};
