import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

export const RecordingDeleteDialog: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const deletingRecordingId = useProjectStore(
    (state) => state.deletingRecordingId,
  );
  const setDeletingRecordingId = useProjectStore(
    (state) => state.setDeletingRecordingId,
  );
  const target = useEngineStore((state) =>
    state.recordings.find((recording) => recording.id === deletingRecordingId),
  );
  const removed = useMutation(endpoints.recording.remove(projectId));

  const close = () => {
    setDeletingRecordingId(undefined);
    removed.reset();
  };

  return (
    <Dialog open={target !== undefined} onClose={close} fullWidth maxWidth='xs'>
      {target && (
        <>
          <DialogTitle>
            {t('pages.project.recording.deleteDialog.title', {
              name: target.name,
            })}
          </DialogTitle>
          <DialogContent>
            <Stack gap={2}>
              <Typography variant='body2' color='text.secondary'>
                {t('pages.project.recording.deleteDialog.text')}
              </Typography>
              {removed.isError && (
                <Alert severity='error'>
                  {t('pages.project.recording.failed')}
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>
              {t('pages.project.recording.deleteDialog.cancel')}
            </Button>
            <Button
              color='error'
              variant='contained'
              loading={removed.isPending}
              onClick={() => {
                removed.mutate(target.id, { onSuccess: close });
              }}
            >
              {t('pages.project.recording.deleteDialog.confirm')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
};
