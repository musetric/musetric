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
} from '@mui/material';
import {
  type AudioOutputSourceKind,
  classifyAudioOutputDevice,
  getRealAudioOutputDevices,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
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

export const AudioOutputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useEngineStore((state) => state.calibrating);
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const audioOutputDeviceId = useEngineStore(
    (state) => state.audioOutputDeviceId,
  );
  const outputDevices = getRealAudioOutputDevices(audioDevices);
  const resolvedOutputDevice = resolveAudioOutputDevice(audioDevices, {
    explicitDeviceId: audioOutputDeviceId,
  });
  const outputSelectionSupported =
    engine.calibration.isOutputSelectionSupported();
  const outputControlUnavailable =
    !outputSelectionSupported || outputDevices.length === 0;
  const outputSelectValue = outputControlUnavailable
    ? ''
    : (resolvedOutputDevice?.deviceId ?? '');
  const outputSelectDisabled =
    outputControlUnavailable || recording || calibrating;

  return (
    <FormControl fullWidth disabled={outputSelectDisabled}>
      <InputLabel shrink>{t('pages.project.audioSettings.output')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.output')}
        disabled={outputSelectDisabled}
        displayEmpty
        value={outputSelectValue}
        onChange={(event) => {
          void engine.calibration.selectOutputDevice(event.target.value);
        }}
        renderValue={(value) => {
          const device = outputDevices.find(
            (outputDevice) => outputDevice.deviceId === value,
          );
          if (!device) {
            return outputControlUnavailable
              ? t('pages.project.audioSettings.outputSystemControlled')
              : t('pages.project.audioSettings.outputPlaceholder');
          }
          return (
            <Stack direction='row' alignItems='center' gap={1} component='span'>
              {outputIconByKind[classifyAudioOutputDevice(device)]}
              <span>
                {device.label ||
                  t('pages.project.audioSettings.outputFallback', { value: 1 })}
              </span>
            </Stack>
          );
        }}
      >
        {outputDevices.map((device, index) => (
          <MenuItem key={device.deviceId} value={device.deviceId}>
            <ListItemIcon>
              {outputIconByKind[classifyAudioOutputDevice(device)]}
            </ListItemIcon>
            <ListItemText
              primary={
                device.label ||
                t('pages.project.audioSettings.outputFallback', {
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
