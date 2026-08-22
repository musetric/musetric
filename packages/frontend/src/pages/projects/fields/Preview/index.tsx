import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import { Box, Button, CircularProgress, Stack } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectPreview } from '../../cards/Preview.js';
import { type PreviewValue } from './schema.js';

export type PreviewFieldProps = {
  value?: PreviewValue;
  setValue: (value?: PreviewValue) => void;
  name?: string;
  loading?: boolean;
};
export const PreviewField: FC<PreviewFieldProps> = (props) => {
  const { value, setValue, name, loading } = props;

  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (!value?.url) return;
      URL.revokeObjectURL(value.url);
    },
    [value?.url],
  );

  return (
    <Stack direction='row' gap={3} alignItems='center'>
      <Box width={88} flexShrink={0}>
        <ProjectPreview url={value?.url} name={name}>
          {loading && (
            <CircularProgress size={24} sx={{ color: 'text.primary' }} />
          )}
        </ProjectPreview>
      </Box>
      <input
        type='file'
        accept='image/*'
        ref={inputRef}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setValue({
            file,
            url: URL.createObjectURL(file),
          });
        }}
      />
      <Stack gap={1} alignItems='flex-start'>
        <Button
          size='small'
          startIcon={<ImageOutlinedIcon />}
          color='primary'
          disabled={loading}
          onClick={() => inputRef.current?.click()}
        >
          {t('pages.projects.fields.preview.select')}
        </Button>
        {value?.url && (
          <Button
            size='small'
            color='inherit'
            onClick={() => {
              setValue(undefined);
            }}
          >
            {t('pages.projects.fields.preview.erase')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
};
