import { TextField } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type NameValue } from './schema.js';

export type NameFieldProps = {
  value?: NameValue;
  setValue: (value?: NameValue) => void;
  error?: string;
  disabled?: boolean;
};
export const NameField: FC<NameFieldProps> = (props) => {
  const { value, setValue, disabled, error } = props;

  const { t } = useTranslation();

  return (
    <TextField
      value={value ?? ''}
      size='small'
      fullWidth
      label={t('pages.projects.fields.name.label')}
      disabled={disabled}
      error={!!error}
      helperText={error}
      slotProps={{
        inputLabel: {
          shrink: true,
        },
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
};
