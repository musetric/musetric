import MenuIcon from '@mui/icons-material/Menu';
import { IconButton, Menu, Tooltip } from '@mui/material';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { AudioSettingsMenuItem } from './AudioSettingsMenuItem.js';
import { SpectrogramSettingsMenuItem } from './SpectrogramSettingsMenuItem.js';

export const ProjectHeaderMenu: FC = () => {
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement>();

  return (
    <>
      <Tooltip title={t('pages.project.menu.title')}>
        <IconButton
          size='small'
          disabled={realtimeFailed}
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
        <AudioSettingsMenuItem
          closeMenu={() => {
            setAnchorEl(undefined);
          }}
        />
        <SpectrogramSettingsMenuItem
          closeMenu={() => {
            setAnchorEl(undefined);
          }}
        />
      </Menu>
    </>
  );
};
