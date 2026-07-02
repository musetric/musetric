import { TextField } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const MinDecibelField: FC = () => {
  const { t } = useTranslation();
  const minDecibel = useSettingsStore((s) => s.minDecibel);
  const setMinDecibel = useSettingsStore((s) => s.setMinDecibel);

  return (
    <TextField
      key={minDecibel}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.minDecibel.label')}
      defaultValue={minDecibel}
      onBlur={(event) => {
        const rawValue = Number(event.target.value);
        if (Number.isNaN(rawValue)) return;
        setMinDecibel(rawValue);
      }}
      slotProps={{
        input: {
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          },
        },
      }}
    />
  );
};
