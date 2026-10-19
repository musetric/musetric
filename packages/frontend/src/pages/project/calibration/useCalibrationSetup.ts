import {
  type AudioOutputSourceKind,
  classifyAudioOutputDevice,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import {
  type CalibrationPlace,
  type CalibrationSpot,
  type CalibrationTexts,
  getCalibrationDevice,
  getCalibrationPlace,
  getCalibrationSpot,
  useCalibrationTexts,
} from './calibrationTexts.js';

export type CalibrationSetup = {
  kind: AudioOutputSourceKind;
  place: CalibrationPlace;
  spot: CalibrationSpot;
  texts: CalibrationTexts;
  outputLabel: string;
};

export const useCalibrationSetup = (): CalibrationSetup => {
  const { t } = useTranslation();
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const outputDeviceId = useEngineStore((state) => state.audioOutputDeviceId);
  const microphoneDeviceId = useEngineStore(
    (state) => state.microphoneDeviceId,
  );
  const output = resolveAudioOutputDevice(audioDevices, {
    explicitDeviceId: outputDeviceId,
  });
  const input = resolveAudioInputDevice(audioDevices, {
    explicitDeviceId: microphoneDeviceId,
  });
  const kind = output ? classifyAudioOutputDevice(output) : 'unknown';
  const place = getCalibrationPlace(kind, output?.label ?? '');
  const device = getCalibrationDevice();
  const spot = getCalibrationSpot(device, input?.label ?? '');
  const texts = useCalibrationTexts(place, device, spot);
  return {
    kind,
    place,
    spot,
    texts,
    outputLabel: output?.label || t('pages.project.calibration.thisOutput'),
  };
};
