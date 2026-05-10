import { TextField } from '@mui/material';
import { normalizeSpectrogramMinFrequency } from '@musetric/audio';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const MinFrequencyField: FC = () => {
  const { t } = useTranslation();
  const minFrequency = useSettingsStore((s) => s.minFrequency);
  const setMinFrequency = useSettingsStore((s) => s.setMinFrequency);

  return (
    <TextField
      key={minFrequency}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.minFrequency.label')}
      defaultValue={minFrequency}
      onBlur={(event) => {
        const value = Number(event.target.value);
        if (Number.isNaN(value)) return;

        const { maxFrequency } = useSettingsStore.getState();
        const nextMinFrequency = normalizeSpectrogramMinFrequency(
          value,
          maxFrequency,
        );
        setMinFrequency(nextMinFrequency);
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
