import { ListItemText, MenuItem } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

export type MixdownMenuItemProps = {
  closeMenu: () => void;
};

export const MixdownMenuItem: FC<MixdownMenuItemProps> = (props) => {
  const { t } = useTranslation();
  const setMixdownOpen = useProjectStore((state) => state.setMixdownOpen);
  const recording = useEngineStore((state) => state.recording);

  return (
    <MenuItem
      disabled={recording}
      onClick={() => {
        props.closeMenu();
        setMixdownOpen(true);
      }}
    >
      <ListItemText primary={t('pages.project.menu.mixdown')} />
    </MenuItem>
  );
};
