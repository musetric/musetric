import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { ProjectPreview } from '../cards/Preview.js';

export type DeleteDialogProps = {
  projectId: number;
};
export const DeleteDialog: FC<DeleteDialogProps> = (props) => {
  const { projectId } = props;

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const projectInfo = useQuery(endpoints.project.get(projectId));

  const close = () => {
    routes.projects.navigate();
  };

  const deleteProject = useMutation(
    endpoints.project.remove(queryClient, projectId),
  );

  return (
    <Dialog
      open
      fullWidth
      maxWidth='xs'
      component='form'
      onKeyDown={async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          await deleteProject.mutateAsync();
          close();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        await deleteProject.mutateAsync();
        close();
      }}
      onClose={close}
    >
      <DialogTitle>{t('pages.projects.dialogs.delete.title')}</DialogTitle>
      <DialogContent>
        <Stack direction='row' gap={3} alignItems='center' pt={1}>
          <Box width={72} flexShrink={0}>
            <ProjectPreview
              url={projectInfo.data?.previewUrl}
              name={projectInfo.data?.name}
            >
              {projectInfo.isPending && (
                <CircularProgress size={20} sx={{ color: 'text.primary' }} />
              )}
            </ProjectPreview>
          </Box>
          <Typography
            sx={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {projectInfo.data?.name}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          color='primary'
          onClick={close}
          disabled={deleteProject.isPending}
        >
          {t('pages.projects.dialogs.delete.cancel')}
        </Button>
        <Button
          type='submit'
          variant='contained'
          color='error'
          disabled={deleteProject.isPending || !projectInfo.isSuccess}
          loading={deleteProject.isPending}
        >
          {t('pages.projects.dialogs.delete.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
