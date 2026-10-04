import { TextField } from '@mui/material';
import { getFrequencyRange } from '@musetric/engine';
import { normalizeSpectrogramMaxFrequency } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../../engine/engine.js';
import { useEngineStore } from '../../../../engine/useEngineStore.js';

export const MaxFrequencyField: FC = () => {
  const { t } = useTranslation();
  const maxFrequency = useEngineStore(
    (state) => getFrequencyRange(state).maxFrequency,
  );

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

        const { minFrequency } = getFrequencyRange(engine.store.get());
        const nextMaxFrequency = normalizeSpectrogramMaxFrequency(
          rawValue,
          minFrequency,
        );
        engine.store.update((state) => {
          state.frequencyRanges[state.spectrogramView].maxFrequency =
            nextMaxFrequency;
        });
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
