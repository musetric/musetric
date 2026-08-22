import { ButtonBase, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { motion } from 'framer-motion';
import { type FC } from 'react';
import { routes } from '../../../../app/router/routes.js';
import { ProjectCardMenu } from './Menu.js';
import { ProjectCardMeta } from './Meta.js';
import { ProjectCardName } from './Name.js';
import { ProjectCardPreview } from './Preview.js';

export type ProjectCardProps = {
  projectInfo: api.project.Item;
};
export const ProjectCard: FC<ProjectCardProps> = (props) => {
  const { projectInfo } = props;

  return (
    <Stack
      component={motion.div}
      layout
      direction='row'
      alignItems='center'
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.35 } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.25 } }}
      sx={{
        borderRadius: 2,
        padding: 2,
        backgroundColor: 'background.paper',
        transition: 'background-color 160ms linear',
        '&:hover, &:focus-within': {
          backgroundColor: 'action.selected',
        },
        '&:hover [data-card-menu], &:focus-within [data-card-menu]': {
          opacity: 1,
        },
        '@media (hover: none)': {
          '[data-card-menu]': { opacity: 1 },
        },
      }}
    >
      <ButtonBase
        component={routes.project.Link}
        params={{ projectId: projectInfo.id }}
        sx={{
          display: 'flex',
          flexGrow: 1,
          minWidth: 0,
          gap: 3,
          alignItems: 'center',
          justifyContent: 'flex-start',
          textAlign: 'left',
          borderRadius: 2,
        }}
      >
        <ProjectCardPreview projectInfo={projectInfo} />
        <Stack minWidth={0} flexGrow={1} gap={0.5}>
          <ProjectCardName name={projectInfo.name} />
          <ProjectCardMeta projectInfo={projectInfo} />
        </Stack>
      </ButtonBase>
      <ProjectCardMenu projectInfo={projectInfo} />
    </Stack>
  );
};
