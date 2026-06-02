import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { allFourierModes } from '@musetric/fft';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const FourierModeField: FC = () => {
  const { t } = useTranslation();
  const currentFourierMode = useSettingsStore((s) => s.fourierMode);
  const setFourierMode = useSettingsStore((s) => s.setFourierMode);

  return (
    <FormControl size='small'>
      <InputLabel>
        {t('pages.project.settings.fields.fourier.label')}
      </InputLabel>
      <Select
        value={currentFourierMode}
        label={t('pages.project.settings.fields.fourier.label')}
      >
        {allFourierModes.map((fourierMode) => (
          <MenuItem
            key={fourierMode}
            value={fourierMode}
            onClick={() => setFourierMode(fourierMode)}
          >
            {fourierMode}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
