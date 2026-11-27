import BluetoothIcon from '@mui/icons-material/Bluetooth';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import SpeakerIcon from '@mui/icons-material/Speaker';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
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
  type AudioOutputSourceKind,
  classifyAudioOutputDevice,
  getRealAudioOutputDevices,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { isRecording } from '@musetric/engine';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const outputIconByKind: Record<AudioOutputSourceKind, ReactNode> = {
  bluetooth: <BluetoothIcon fontSize='small' />,
  wiredHeadset: <HeadphonesIcon fontSize='small' />,
  builtIn: <SpeakerIcon fontSize='small' />,
  unknown: <VolumeUpIcon fontSize='small' />,
};

const defaultChoice = '';

export const AudioOutputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore(isRecording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const audioOutputDeviceId = useEngineStore(
    (state) => state.audioOutputDeviceId,
  );
  const outputDevices = getRealAudioOutputDevices(audioDevices);
  const defaultOutputDevice = resolveAudioOutputDevice(audioDevices, {});
  const chosenOutputDevice = outputDevices.find(
    (device) => device.deviceId === audioOutputDeviceId,
  );
  const outputSelectionSupported =
    engine.calibration.isOutputSelectionSupported();
  const outputControlUnavailable =
    !outputSelectionSupported || outputDevices.length === 0;
  const outputSelectValue = outputControlUnavailable
    ? defaultChoice
    : (chosenOutputDevice?.deviceId ?? defaultChoice);
  const outputSelectDisabled =
    outputControlUnavailable || recording || calibrating;
  const nameOutput = (device: MediaDeviceInfo) =>
    device.label ||
    t('pages.project.audioSettings.outputFallback', {
      value: outputDevices.indexOf(device) + 1,
    });
  const nameDefault = (device: MediaDeviceInfo) =>
    t('pages.project.audioSettings.default', { name: nameOutput(device) });
  const findOutput = (value: string) =>
    value === defaultChoice
      ? defaultOutputDevice
      : outputDevices.find((device) => device.deviceId === value);

  return (
    <FormControl fullWidth disabled={outputSelectDisabled}>
      <InputLabel shrink>{t('pages.project.audioSettings.output')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.output')}
        disabled={outputSelectDisabled}
        displayEmpty
        value={outputSelectValue}
        onChange={(event) => {
          const { value } = event.target;
          void engine.calibration.selectOutputDevice(
            value === defaultChoice ? undefined : value,
          );
        }}
        renderValue={(value) => {
          const device = outputControlUnavailable
            ? undefined
            : findOutput(value);
          if (!device) {
            return outputControlUnavailable
              ? t('pages.project.audioSettings.outputSystemControlled')
              : t('pages.project.audioSettings.outputPlaceholder');
          }
          return (
            <Stack
              direction='row'
              component='span'
              sx={{ alignItems: 'center', gap: 1 }}
            >
              {outputIconByKind[classifyAudioOutputDevice(device)]}
              <Typography component='span' variant='inherit' noWrap>
                {value === defaultChoice
                  ? nameDefault(device)
                  : nameOutput(device)}
              </Typography>
            </Stack>
          );
        }}
      >
        {defaultOutputDevice && (
          <MenuItem value={defaultChoice}>
            <ListItemIcon>
              {outputIconByKind[classifyAudioOutputDevice(defaultOutputDevice)]}
            </ListItemIcon>
            <ListItemText primary={nameDefault(defaultOutputDevice)} />
          </MenuItem>
        )}
        {outputDevices.map((device) => (
          <MenuItem key={device.deviceId} value={device.deviceId}>
            <ListItemIcon>
              {outputIconByKind[classifyAudioOutputDevice(device)]}
            </ListItemIcon>
            <ListItemText primary={nameOutput(device)} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
