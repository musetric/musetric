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
  Typography,
} from '@mui/material';
import {
  type AudioInputSourceKind,
  classifyAudioInputDevice,
  getRealAudioInputDevices,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';
import { isRecording } from '@musetric/engine';
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

const defaultChoice = '';

export const AudioInputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore(isRecording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const microphoneDeviceId = useEngineStore(
    (state) => state.microphoneDeviceId,
  );
  const inputDevices = getRealAudioInputDevices(audioDevices);
  const defaultInputDevice = resolveAudioInputDevice(audioDevices, {});
  const chosenInputDevice = inputDevices.find(
    (device) => device.deviceId === microphoneDeviceId,
  );
  const inputSelectValue = chosenInputDevice?.deviceId ?? defaultChoice;
  const nameInput = (device: MediaDeviceInfo) =>
    device.label ||
    t('pages.project.audioSettings.inputFallback', {
      value: inputDevices.indexOf(device) + 1,
    });
  const nameDefault = (device: MediaDeviceInfo) =>
    t('pages.project.audioSettings.default', { name: nameInput(device) });

  return (
    <FormControl fullWidth disabled={recording || calibrating}>
      <InputLabel shrink>{t('pages.project.audioSettings.input')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.input')}
        disabled={recording || calibrating}
        displayEmpty
        value={inputSelectValue}
        onChange={(event) => {
          const { value } = event.target;
          void engine.calibration.selectInputDevice(
            value === defaultChoice ? undefined : value,
          );
        }}
        renderValue={(value) => {
          const device =
            value === defaultChoice
              ? defaultInputDevice
              : inputDevices.find(
                  (inputDevice) => inputDevice.deviceId === value,
                );
          if (!device) {
            return t('pages.project.audioSettings.inputPlaceholder');
          }
          return (
            <Stack
              direction='row'
              component='span'
              sx={{ alignItems: 'center', gap: 1 }}
            >
              {inputIconByKind[classifyAudioInputDevice(device)]}
              <Typography component='span' variant='inherit' noWrap>
                {value === defaultChoice
                  ? nameDefault(device)
                  : nameInput(device)}
              </Typography>
            </Stack>
          );
        }}
      >
        {defaultInputDevice && (
          <MenuItem value={defaultChoice}>
            <ListItemIcon>
              {inputIconByKind[classifyAudioInputDevice(defaultInputDevice)]}
            </ListItemIcon>
            <ListItemText primary={nameDefault(defaultInputDevice)} />
          </MenuItem>
        )}
        {inputDevices.map((device) => (
          <MenuItem key={device.deviceId} value={device.deviceId}>
            <ListItemIcon>
              {inputIconByKind[classifyAudioInputDevice(device)]}
            </ListItemIcon>
            <ListItemText primary={nameInput(device)} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
