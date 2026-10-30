import {
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
} from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';

const percent = 100;

export const StencilField: FC = () => {
  const { t } = useTranslation();
  const stencil = useSettingsStore((s) => s.stencil);
  const setStencilEnabled = useSettingsStore((s) => s.setStencilEnabled);
  const setStencilOpacity = useSettingsStore((s) => s.setStencilOpacity);
  const setStencilOctaveShift = useSettingsStore(
    (s) => s.setStencilOctaveShift,
  );
  const octaves = [
    {
      shift: -1,
      label: t('pages.project.settings.fields.stencil.octaveLower'),
    },
    {
      shift: 0,
      label: t('pages.project.settings.fields.stencil.octaveSinger'),
    },
    {
      shift: 1,
      label: t('pages.project.settings.fields.stencil.octaveHigher'),
    },
  ];

  return (
    <Stack>
      <FormControlLabel
        label={t('pages.project.settings.fields.stencil.label')}
        control={
          <Switch
            checked={stencil.enabled}
            onChange={(event) => setStencilEnabled(event.target.checked)}
          />
        }
      />
      <Slider
        size='small'
        disabled={!stencil.enabled}
        value={Math.round(stencil.opacity * percent)}
        min={0}
        max={percent}
        valueLabelDisplay='auto'
        valueLabelFormat={(value) => `${value}%`}
        aria-label={t('pages.project.settings.fields.stencil.opacity')}
        onChange={(_, value) => setStencilOpacity(Number(value) / percent)}
      />
      <FormControl size='small' disabled={!stencil.enabled}>
        <InputLabel>
          {t('pages.project.settings.fields.stencil.octave')}
        </InputLabel>
        <Select
          value={stencil.octaveShift}
          label={t('pages.project.settings.fields.stencil.octave')}
          onChange={(event) =>
            setStencilOctaveShift(Number(event.target.value))
          }
        >
          {octaves.map((octave) => (
            <MenuItem key={octave.shift} value={octave.shift}>
              {octave.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
};
