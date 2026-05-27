import {
  FormControl,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
} from '@mui/material';
import { classifyAudioOutputDevice } from '@musetric/audio/recording';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { renderAudioOutputIcon } from './audioDeviceIcon.js';
import { getAudioDeviceLabel } from './audioDeviceLabel.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';
import { useSelectAudioOutputDevice } from './useAudioSettingsActions.js';
import {
  getAudioSettingsOutputSelectionSupported,
  useAudioSettingsOutputDevices,
  useAudioSettingsOutputSelectValue,
} from './useAudioSettingsDevices.js';

export const AudioOutputSelect: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const calibrating = useAudioSettingsStore((state) => state.calibrating);
  const outputDevices = useAudioSettingsOutputDevices();
  const outputSelectValue = useAudioSettingsOutputSelectValue();
  const outputSelectionSupported = getAudioSettingsOutputSelectionSupported();
  const selectOutputDevice = useSelectAudioOutputDevice();

  return (
    <FormControl
      fullWidth
      disabled={!outputSelectionSupported || recording || calibrating}
    >
      <InputLabel>{t('pages.project.audioSettings.output')}</InputLabel>
      <Select<string>
        label={t('pages.project.audioSettings.output')}
        displayEmpty
        value={outputSelectValue}
        onChange={(event) => {
          void selectOutputDevice(event.target.value);
        }}
        renderValue={(value) => {
          const device = outputDevices.find(
            (outputDevice) => outputDevice.deviceId === value,
          );
          if (!device) {
            return outputSelectionSupported
              ? t('pages.project.audioSettings.outputPlaceholder')
              : t('pages.project.audioSettings.outputUnsupported');
          }
          const kind = classifyAudioOutputDevice(device);
          return (
            <Stack direction='row' alignItems='center' gap={1} component='span'>
              {renderAudioOutputIcon(kind)}
              <span>
                {getAudioDeviceLabel(
                  device,
                  t('pages.project.audioSettings.outputFallback', {
                    value: 1,
                  }),
                )}
              </span>
            </Stack>
          );
        }}
      >
        {outputDevices.map((device, index) => {
          const kind = classifyAudioOutputDevice(device);
          return (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              <ListItemIcon>{renderAudioOutputIcon(kind)}</ListItemIcon>
              <ListItemText
                primary={getAudioDeviceLabel(
                  device,
                  t('pages.project.audioSettings.outputFallback', {
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
