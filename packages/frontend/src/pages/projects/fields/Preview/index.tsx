import HideImageIcon from '@mui/icons-material/HideImage';
import ImageIcon from '@mui/icons-material/Image';
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectPreview } from '../../cards/Preview.js';
import { type PreviewValue } from './schema.js';

export type PreviewFieldProps = {
  value?: PreviewValue;
  setValue: (value?: PreviewValue) => void;
  loading?: boolean;
};
export const PreviewField: FC<PreviewFieldProps> = (props) => {
  const { value, setValue, loading } = props;

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
    <Stack>
      <Typography color='textSecondary' variant='subtitle2' marginLeft={2}>
        {t('pages.projects.fields.preview.label')}
      </Typography>
      <ProjectPreview url={value?.url}>
        {loading && <CircularProgress sx={{ color: 'text.primary' }} />}
      </ProjectPreview>
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
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
        {value?.url ? (
          <Button
            color='error'
            startIcon={<HideImageIcon />}
            onClick={() => {
              setValue(undefined);
            }}
          >
            {t('pages.projects.fields.preview.erase')}
          </Button>
        ) : (
          <Box />
        )}
        <Button startIcon={<KeyboardDoubleArrowUpIcon />} disabled>
          {t('pages.projects.fields.preview.drag')}
        </Button>
        <Button
          startIcon={<ImageIcon />}
          color='primary'
          disabled={loading}
          onClick={() => inputRef.current?.click()}
        >
          {t('pages.projects.fields.preview.select')}
        </Button>
      </Box>
    </Stack>
  );
};
