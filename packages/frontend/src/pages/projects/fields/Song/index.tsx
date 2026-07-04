import { Button, Stack, Typography } from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SongValue } from './schema.js';

export type SongFieldProps = {
  value?: SongValue;
  setValue: (value: SongValue) => void;
  disabled?: boolean;
};
export const SongField: FC<SongFieldProps> = (props) => {
  const { value, setValue, disabled } = props;

  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(
    () => () => {
      if (!value) return;
      URL.revokeObjectURL(value.url);
    },
    [value],
  );

  return (
    <Stack
      onDrop={(event) => {
        setIsDragging(false);
        const file = event.dataTransfer.files.item(0);
        if (!file) return;
        setValue({
          file,
          url: URL.createObjectURL(file),
        });
      }}
      onDragOver={() => {
        setIsDragging(true);
      }}
      onDragLeave={() => {
        setIsDragging(false);
      }}
      height='180px'
      justifyContent='center'
      alignItems='center'
      sx={{
        border: '2px dashed',
        borderColor: isDragging ? 'primary.main' : 'divider',
        borderRadius: 2,
        transition: 'border-color 0.2s',
      }}
    >
      <input
        type='file'
        accept='audio/*'
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
      <Button
        variant='contained'
        color='primary'
        onClick={() => {
          inputRef.current?.click();
        }}
        disabled={disabled}
      >
        {t('pages.projects.dialogs.create.select')}
      </Button>
      <Typography variant='body1' gutterBottom>
        {t('pages.projects.dialogs.create.dragDrop')}
      </Typography>
    </Stack>
  );
};
