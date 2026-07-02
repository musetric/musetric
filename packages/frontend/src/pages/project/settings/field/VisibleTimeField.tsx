import { TextField } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const VisibleTimeField: FC = () => {
  const { t } = useTranslation();
  const visibleTime = useSettingsStore((s) => s.visibleTime);
  const setVisibleTime = useSettingsStore((s) => s.setVisibleTime);

  return (
    <TextField
      key={visibleTime}
      size='small'
      type='number'
      label={t('pages.project.settings.fields.visibleTime.label')}
      defaultValue={visibleTime}
      onBlur={(event) => {
        const rawValue = Number(event.target.value);
        if (Number.isNaN(rawValue)) return;
        setVisibleTime(Math.max(0.1, Math.min(rawValue, 60)));
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
