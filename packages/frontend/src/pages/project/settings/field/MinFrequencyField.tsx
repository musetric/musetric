import { TextField } from '@mui/material';
import { getFrequencyRange } from '@musetric/engine';
import { normalizeSpectrogramMinFrequency } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../../engine/engine.js';
import { useEngineStore } from '../../../../engine/useEngineStore.js';

export const MinFrequencyField: FC = () => {
  const { t } = useTranslation();
  const minFrequency = useEngineStore(
    (state) => getFrequencyRange(state).minFrequency,
  );

  return (
    <TextField
      key={minFrequency}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.minFrequency.label')}
      defaultValue={minFrequency}
      onBlur={(event) => {
        const rawValue = Number(event.target.value);
        if (Number.isNaN(rawValue)) return;

        const { maxFrequency } = getFrequencyRange(engine.store.get());
        const nextMinFrequency = normalizeSpectrogramMinFrequency(
          rawValue,
          maxFrequency,
        );
        engine.store.update((state) => {
          state.frequencyRanges[state.spectrogramView].minFrequency =
            nextMinFrequency;
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
