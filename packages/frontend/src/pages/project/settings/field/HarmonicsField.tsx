import { FormControlLabel, Stack, Switch } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

export const HarmonicsField: FC = () => {
  const { t } = useTranslation();
  const hintsEnabled = useSettingsStore((s) => s.harmonics.enabled);
  const setHarmonicsEnabled = useSettingsStore((s) => s.setHarmonicsEnabled);
  const comparisonEnabled = useSettingsStore(
    (s) => s.harmonicComparison.enabled,
  );
  const setHarmonicComparisonEnabled = useSettingsStore(
    (s) => s.setHarmonicComparisonEnabled,
  );

  return (
    <Stack>
      <FormControlLabel
        label={t('pages.project.settings.fields.harmonics.label')}
        control={
          <Switch
            checked={hintsEnabled}
            onChange={(event) => setHarmonicsEnabled(event.target.checked)}
          />
        }
      />
      <FormControlLabel
        label={t('pages.project.settings.fields.harmonicComparison.label')}
        control={
          <Switch
            checked={comparisonEnabled}
            onChange={(event) =>
              setHarmonicComparisonEnabled(event.target.checked)
            }
          />
        }
      />
    </Stack>
  );
};
