import {
  FormControl,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
} from '@mui/material';
import { classifyAudioInputDevice } from '@musetric/audio/recording';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { renderAudioInputIcon } from './audioDeviceIcon.js';
import { getAudioDeviceLabel } from './audioDeviceLabel.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';
import { useSelectAudioInputDevice } from './useAudioSettingsActions.js';
import {
  useAudioSettingsInputDevices,
  useAudioSettingsInputSelectValue,
} from './useAudioSettingsDevices.js';

export const AudioInputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useAudioSettingsStore((state) => state.calibrating);
  const inputDevices = useAudioSettingsInputDevices();
  const inputSelectValue = useAudioSettingsInputSelectValue();
  const selectInputDevice = useSelectAudioInputDevice();

  return (
    <FormControl fullWidth disabled={recording || calibrating}>
      <InputLabel>{t('pages.project.audioSettings.input')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.input')}
        displayEmpty
        value={inputSelectValue}
        onChange={(event) => {
          void selectInputDevice(event.target.value);
        }}
        renderValue={(value) => {
          const device = inputDevices.find(
            (inputDevice) => inputDevice.deviceId === value,
          );
          if (!device) {
            return t('pages.project.audioSettings.inputPlaceholder');
          }
          const kind = classifyAudioInputDevice(device);
          return (
            <Stack direction='row' alignItems='center' gap={1} component='span'>
              {renderAudioInputIcon(kind)}
              <span>
                {getAudioDeviceLabel(
                  device,
                  t('pages.project.audioSettings.inputFallback', {
                    value: 1,
                  }),
                )}
              </span>
            </Stack>
          );
        }}
      >
        {inputDevices.map((device, index) => {
          const kind = classifyAudioInputDevice(device);
          return (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              <ListItemIcon>{renderAudioInputIcon(kind)}</ListItemIcon>
              <ListItemText
                primary={getAudioDeviceLabel(
                  device,
                  t('pages.project.audioSettings.inputFallback', {
                    value: index + 1,
                  }),
                )}
              />
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
};
