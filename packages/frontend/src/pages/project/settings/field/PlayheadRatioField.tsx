import { TextField } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const PlayheadRatioField: FC = () => {
  const { t } = useTranslation();
  const playheadRatio = useSettingsStore((s) => s.playheadRatio);
  const setPlayheadRatio = useSettingsStore((s) => s.setPlayheadRatio);

  return (
    <TextField
      key={playheadRatio}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.playheadRatio.label')}
      defaultValue={playheadRatio}
      onBlur={(event) => {
        const rawValue = Number(event.target.value);
        if (Number.isNaN(rawValue)) return;
        setPlayheadRatio(Math.max(0, Math.min(rawValue, 1)));
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
