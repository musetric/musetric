import { FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { vocalMarkKinds } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { vocalKindLabel } from '../../vocal/vocalMarkText.js';
import { useSettingsStore } from '../store.js';

export const VocalCoachField: FC = () => {
  const { t } = useTranslation();
  const kinds = useSettingsStore((s) => s.vocalCoach);
  const setKind = useSettingsStore((s) => s.setVocalCoachKind);

  return (
    <Stack>
      <Typography variant='subtitle2'>
        {t('pages.project.settings.fields.vocalCoach.label')}
      </Typography>
      {vocalMarkKinds.map((kind) => (
        <FormControlLabel
          key={kind}
          label={vocalKindLabel(t, kind)}
          control={
            <Switch
              checked={kinds[kind]}
              onChange={(event) => setKind(kind, event.target.checked)}
            />
          }
        />
      ))}
    </Stack>
  );
};
