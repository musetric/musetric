import { zodResolver } from '@hookform/resolvers/zod';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type TFunction } from 'i18next';
import { type FC, useEffect, useState, useSyncExternalStore } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { endpoints } from '../../../api/index.js';
import {
  dismissReceivedSong,
  isReceivedSongApplying,
  subscribeReceivedSongApplying,
  subscribeReceivedSongs,
  takeReceivedSong,
} from '../../../app/receivedSong.js';
import { routes } from '../../../app/router/routes.js';
import { stripExt } from '../../../common/stripExt.js';
import { SongPlayer } from '../common/SongPlayer.js';
import { NameField } from '../fields/Name/index.js';
import { nameValueSchema } from '../fields/Name/schema.js';
import { PreviewField } from '../fields/Preview/index.js';
import { previewValueSchema } from '../fields/Preview/schema.js';
import { SongField } from '../fields/Song/index.js';
import { songValueSchema } from '../fields/Song/schema.js';

const schema = (t: TFunction) =>
  z
    .object({
      song: songValueSchema().optional(),
      name: nameValueSchema(t).optional(),
      preview: previewValueSchema().optional(),
    })
    .pipe(
      z.object({
        song: songValueSchema(),
        name: nameValueSchema(t),
        preview: previewValueSchema().optional(),
      }),
    );
type SubmitValue = z.output<ReturnType<typeof schema>>;

export const CreateDialog: FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const create = useMutation(endpoints.project.create(queryClient));
  const models = useQuery(endpoints.models.download());
  const missingBytes = models.data?.missingBytes ?? 0;
  const [coverOpen, setCoverOpen] = useState(false);
  const [shareVersion, setShareVersion] = useState(0);
  const receiving = useSyncExternalStore(
    subscribeReceivedSongApplying,
    isReceivedSongApplying,
  );

  const {
    setValue,
    setError,
    clearErrors,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema(t)),
  });

  const close = () => {
    dismissReceivedSong();
    routes.home.navigate();
  };
  const onSubmit = (value: SubmitValue) => {
    create.mutate(
      {
        song: value.song.file,
        name: value.name,
        preview: value.preview?.file,
      },
      {
        onSuccess: (project) => {
          routes.project.replace({ projectId: project.id });
        },
      },
    );
  };

  const song = useWatch({
    control,
    name: 'song',
  });
  const name = useWatch({
    control,
    name: 'name',
  });

  useEffect(
    () =>
      subscribeReceivedSongs(() => {
        setShareVersion((version) => version + 1);
      }),
    [],
  );

  useEffect(() => {
    if (create.isPending) return undefined;
    const controller = new AbortController();
    const taken = takeReceivedSong(controller.signal);
    if (!taken) return undefined;
    void taken.received.then((received) => {
      if (controller.signal.aborted) return;
      if ('failed' in received) {
        setError('song', {
          type: 'received',
          message: t('pages.projects.dialogs.create.failed'),
        });
      } else {
        clearErrors('song');
        setValue('song', {
          file: received.file,
          url: URL.createObjectURL(received.file),
        });
        setValue('name', stripExt(received.file.name));
      }
      taken.release();
    });
    return () => {
      controller.abort();
      taken.giveBack();
    };
  }, [shareVersion, create.isPending, setValue, setError, clearErrors, t]);

  useEffect(() => {
    if (!song) return undefined;
    const { url } = song;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [song]);

  return (
    <Dialog
      open
      fullWidth
      maxWidth='xs'
      component='form'
      onClose={close}
      onSubmit={handleSubmit(onSubmit)}
    >
      <DialogTitle>{t('pages.projects.dialogs.create.title')}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 4, pt: 1 }}>
          {errors.song?.type === 'received' && (
            <Alert severity='error'>{errors.song.message}</Alert>
          )}
          {!song && (
            <Controller
              name='song'
              control={control}
              render={(controlProps) => {
                const { field } = controlProps;
                return (
                  <SongField
                    value={field.value}
                    setValue={(newSong) => {
                      clearErrors('song');
                      field.onChange(newSong);
                      setValue('name', stripExt(newSong.file.name));
                    }}
                    disabled={create.isPending || receiving}
                  />
                );
              }}
            />
          )}
          {song && (
            <>
              <Controller
                name='name'
                control={control}
                render={(controlProps) => {
                  const { field } = controlProps;
                  return (
                    <NameField
                      value={field.value}
                      setValue={field.onChange}
                      error={errors.name?.message}
                      disabled={create.isPending}
                    />
                  );
                }}
              />
              <SongPlayer key={song.url} url={song.url} />
              {coverOpen ? (
                <Controller
                  name='preview'
                  control={control}
                  render={(controlProps) => {
                    const { field } = controlProps;
                    return (
                      <PreviewField
                        value={field.value}
                        setValue={field.onChange}
                        name={name}
                        loading={create.isPending}
                      />
                    );
                  }}
                />
              ) : (
                <Button
                  size='small'
                  color='primary'
                  startIcon={<ImageOutlinedIcon />}
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setCoverOpen(true)}
                >
                  {t('pages.projects.fields.preview.add')}
                </Button>
              )}
              <Stack direction='row' sx={{ gap: 2, alignItems: 'center' }}>
                <MemoryOutlinedIcon
                  fontSize='small'
                  sx={{ color: 'text.disabled' }}
                />
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                  {t('pages.projects.dialogs.create.localNotice')}
                </Typography>
              </Stack>
              {missingBytes > 0 && (
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                  {t('pages.projects.dialogs.create.models', {
                    size: (missingBytes / 1e9).toFixed(1),
                  })}
                </Typography>
              )}
              {create.isError && (
                <Alert severity='error'>
                  {endpoints.project.isUnsupportedSong(create.error)
                    ? t('pages.projects.dialogs.create.unsupported')
                    : t('pages.projects.dialogs.create.failed')}
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color='primary' onClick={close} disabled={create.isPending}>
          {t('pages.projects.dialogs.create.cancel')}
        </Button>
        <Button
          type='submit'
          color='primary'
          variant='contained'
          disabled={!song || create.isPending}
          loading={create.isPending || receiving}
        >
          {t('pages.projects.dialogs.create.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
