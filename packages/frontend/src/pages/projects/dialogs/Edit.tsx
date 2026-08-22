import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type TFunction } from 'i18next';
import { type FC, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { QueryError } from '../../../components/QueryView/QueryError.js';
import { NameField } from '../fields/Name/index.js';
import { nameValueSchema } from '../fields/Name/schema.js';
import { PreviewField } from '../fields/Preview/index.js';
import { previewValueSchema } from '../fields/Preview/schema.js';

const schema = (t: TFunction) =>
  z.object({
    name: nameValueSchema(t),
    preview: previewValueSchema().optional(),
  });

type FormValue = z.infer<ReturnType<typeof schema>>;

export type EditDialogProps = {
  projectId: number;
};
export const EditDialog: FC<EditDialogProps> = (props) => {
  const { projectId } = props;

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const project = useQuery(endpoints.project.get(projectId));
  const edit = useMutation(endpoints.project.edit(queryClient, projectId));

  const {
    reset,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValue>({
    resolver: zodResolver(schema(t)),
  });

  useEffect(() => {
    if (!project.data) return;
    const { name, previewUrl } = project.data;
    reset({ name, preview: { url: previewUrl } });
  }, [project.data, reset]);

  const close = () => {
    routes.projects.navigate();
  };

  const onSubmit = async (value: FormValue) => {
    const isNameChanged = value.name !== project.data?.name;
    const isPreviewChanged = value.preview?.url !== project.data?.previewUrl;
    await edit.mutateAsync({
      name: isNameChanged ? value.name : undefined,
      preview: isPreviewChanged ? value.preview?.file : undefined,
      withoutPreview: isPreviewChanged ? !value.preview?.url : undefined,
    });
    close();
  };

  const renderContent = () => {
    if (project.isError) {
      return <QueryError error={project.error} />;
    }
    return (
      <Stack direction='column' gap={4} pt={1}>
        <Controller
          name='preview'
          control={control}
          render={(controlProps) => {
            const { field } = controlProps;
            return (
              <PreviewField
                value={field.value}
                setValue={field.onChange}
                name={project.data?.name}
                loading={project.isPending}
              />
            );
          }}
        />
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
                disabled={project.isPending || edit.isPending}
              />
            );
          }}
        />
      </Stack>
    );
  };

  return (
    <Dialog
      open
      fullWidth
      maxWidth='xs'
      component='form'
      onSubmit={handleSubmit(onSubmit)}
      onClose={close}
    >
      <DialogTitle>{t('pages.projects.dialogs.edit.title')}</DialogTitle>
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {renderContent()}
      </DialogContent>
      <DialogActions>
        <Button color='primary' onClick={close} disabled={edit.isPending}>
          {t('pages.projects.dialogs.edit.cancel')}
        </Button>
        <Button
          type='submit'
          disabled={edit.isPending || !project.isSuccess}
          loading={edit.isPending}
          color='primary'
          variant='contained'
        >
          {t('pages.projects.dialogs.edit.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
