import BluetoothIcon from '@mui/icons-material/Bluetooth';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import MicIcon from '@mui/icons-material/Mic';
import {
  FormControl,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
} from '@mui/material';
import {
  type AudioInputSourceKind,
  classifyAudioInputDevice,
  getRealAudioInputDevices,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const inputIconByKind: Record<AudioInputSourceKind, ReactNode> = {
  bluetooth: <BluetoothIcon fontSize='small' />,
  wiredHeadset: <HeadphonesIcon fontSize='small' />,
  builtIn: <MicIcon fontSize='small' />,
  unknown: <MicIcon fontSize='small' />,
};

export const AudioInputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const microphoneDeviceId = useEngineStore(
    (state) => state.microphoneDeviceId,
  );
  const inputDevices = getRealAudioInputDevices(audioDevices);
  const resolvedInputDevice = resolveAudioInputDevice(audioDevices, {
    explicitDeviceId: microphoneDeviceId,
    preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
  });
  const inputSelectValue = resolvedInputDevice?.deviceId ?? '';

  return (
    <FormControl fullWidth disabled={recording || calibrating}>
      <InputLabel shrink>{t('pages.project.audioSettings.input')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.input')}
        disabled={recording || calibrating}
        displayEmpty
        value={inputSelectValue}
        onChange={(event) => {
          void engine.calibration.selectInputDevice(event.target.value);
        }}
        renderValue={(value) => {
          const device = inputDevices.find(
            (inputDevice) => inputDevice.deviceId === value,
          );
          if (!device) {
            return t('pages.project.audioSettings.inputPlaceholder');
          }
          return (
            <Stack direction='row' alignItems='center' gap={1} component='span'>
              {inputIconByKind[classifyAudioInputDevice(device)]}
              <span>
                {device.label ||
                  t('pages.project.audioSettings.inputFallback', { value: 1 })}
              </span>
            </Stack>
          );
        }}
      >
        {inputDevices.map((device, index) => (
          <MenuItem key={device.deviceId} value={device.deviceId}>
            <ListItemIcon>
              {inputIconByKind[classifyAudioInputDevice(device)]}
            </ListItemIcon>
            <ListItemText
              primary={
                device.label ||
                t('pages.project.audioSettings.inputFallback', {
                  value: index + 1,
                })
              }
            />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
