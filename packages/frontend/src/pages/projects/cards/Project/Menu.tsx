import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../../app/router/routes.js';

export type ProjectCardMenuProps = {
  projectInfo: api.project.Item;
};
export const ProjectCardMenu: FC<ProjectCardMenuProps> = (props) => {
  const { projectInfo } = props;

  const { t } = useTranslation();

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement>();

  return (
    <>
      <IconButton
        data-card-menu=''
        size='small'
        aria-label={t('pages.projects.cards.menu.title')}
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        sx={{
          opacity: anchorEl ? 1 : 0,
          transition: 'opacity 120ms linear',
        }}
      >
        <MoreVertIcon fontSize='small' />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          component={routes.projectsEdit.Link}
          params={{ projectId: projectInfo.id }}
          onClick={() => {
            setAnchorEl(undefined);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize='small' />
          </ListItemIcon>
          <ListItemText primary={t('pages.projects.cards.menu.editProject')} />
        </MenuItem>
        <MenuItem
          component={routes.projectsDelete.Link}
          params={{ projectId: projectInfo.id }}
          onClick={() => {
            setAnchorEl(undefined);
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize='small' />
          </ListItemIcon>
          <ListItemText
            primary={t('pages.projects.cards.menu.deleteProject')}
          />
        </MenuItem>
      </Menu>
    </>
  );
};
