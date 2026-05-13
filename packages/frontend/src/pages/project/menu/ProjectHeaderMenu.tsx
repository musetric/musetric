import MenuIcon from '@mui/icons-material/Menu';
import { IconButton, Menu, Tooltip } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SpectrogramSettingsMenuItem } from './SpectrogramSettingsMenuItem.js';

export const ProjectHeaderMenu: FC = () => {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement>();

  return (
    <>
      <Tooltip title={t('pages.project.menu.title')}>
        <IconButton
          size='small'
          aria-label={t('pages.project.menu.title')}
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
          }}
        >
          <MenuIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <SpectrogramSettingsMenuItem
          closeMenu={() => {
            setAnchorEl(undefined);
          }}
        />
      </Menu>
    </>
  );
};
