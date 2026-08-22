import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Box,
  CircularProgress,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC, type PropsWithChildren, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';
import { stripExt } from '../../common/stripExt.js';

const getDroppedSong = (dataTransfer: DataTransfer): File | undefined => {
  const files = [...dataTransfer.files];
  return files.find((file) => file.type.startsWith('audio/')) ?? files.at(0);
};

const getProjectName = (fileName: string) => {
  const name = stripExt(fileName);
  return name.length >= 3 ? name : fileName;
};

export const ProjectsDropZone: FC<PropsWithChildren> = (props) => {
  const { children } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const create = useMutation(endpoints.project.create(queryClient));
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const overlayVisible = dragging || create.isPending;

  return (
    <Box
      position='relative'
      width='100%'
      height='100dvh'
      onDragOver={(event) => {
        event.preventDefault();
        if (!create.isPending) {
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        const { relatedTarget } = event;
        if (
          relatedTarget instanceof Node &&
          event.currentTarget.contains(relatedTarget)
        ) {
          return;
        }
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const song = getDroppedSong(event.dataTransfer);
        if (!song) {
          return;
        }
        void create
          .mutateAsync({ song, name: getProjectName(song.name) })
          .then((project) => {
            routes.project.navigate({ projectId: project.id });
          })
          .catch(() => {
            setFailed(true);
          });
      }}
    >
      {children}
      {overlayVisible && (
        <Stack
          position='absolute'
          top={0}
          right={0}
          bottom={0}
          left={0}
          alignItems='center'
          justifyContent='center'
          gap={3}
          sx={{
            backgroundColor: 'rgba(10, 10, 12, 0.88)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {create.isPending ? (
            <CircularProgress color='primary' />
          ) : (
            <UploadFileOutlinedIcon
              sx={{ fontSize: 48, color: 'primary.main' }}
            />
          )}
          <Typography variant='h5'>
            {create.isPending
              ? t('pages.projects.drop.uploading')
              : t('pages.projects.drop.hint')}
          </Typography>
        </Stack>
      )}
      <Snackbar
        open={failed}
        autoHideDuration={6000}
        onClose={() => setFailed(false)}
      >
        <Alert severity='error' onClose={() => setFailed(false)}>
          {t('pages.projects.drop.failed')}
        </Alert>
      </Snackbar>
    </Box>
  );
};
