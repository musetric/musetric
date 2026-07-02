import { TextField } from '@mui/material';
import { normalizeSpectrogramMaxFrequency } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const MaxFrequencyField: FC = () => {
  const { t } = useTranslation();
  const maxFrequency = useSettingsStore((s) => s.maxFrequency);
  const setMaxFrequency = useSettingsStore((s) => s.setMaxFrequency);

  return (
    <TextField
      key={maxFrequency}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.maxFrequency.label')}
      defaultValue={maxFrequency}
      onBlur={(event) => {
        const rawValue = Number(event.target.value);
        if (Number.isNaN(rawValue)) return;

        const { minFrequency } = useSettingsStore.getState();
        const nextMaxFrequency = normalizeSpectrogramMaxFrequency(
          rawValue,
          minFrequency,
        );
        setMaxFrequency(nextMaxFrequency);
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
