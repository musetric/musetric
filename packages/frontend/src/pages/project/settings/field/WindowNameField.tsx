import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { allWindowFunctionNames } from '@musetric/fft';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const WindowNameField: FC = () => {
  const { t } = useTranslation();
  const currentFilter = useSettingsStore((s) => s.windowName);
  const setFilter = useSettingsStore((s) => s.setWindowName);

  return (
    <FormControl size='small'>
      <InputLabel>
        {t('pages.project.settings.fields.windowName.label')}
      </InputLabel>
      <Select
        value={currentFilter}
        label={t('pages.project.settings.fields.windowName.label')}
      >
        {allWindowFunctionNames.map((name) => (
          <MenuItem key={name} value={name} onClick={() => setFilter(name)}>
            {name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
