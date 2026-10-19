import { type AudioOutputSourceKind } from '@musetric/audio/recording';
import { useTranslation } from 'react-i18next';

export type CalibrationPlace = 'headphones' | 'speaker' | 'unknown';

export const getCalibrationPlace = (
  kind: AudioOutputSourceKind,
  label: string,
): CalibrationPlace => {
  if (kind === 'builtIn' || /speaker/i.test(label)) {
    return 'speaker';
  }
  if (kind === 'bluetooth' || kind === 'wiredHeadset') {
    return 'headphones';
  }
  return 'unknown';
};

export type CalibrationDevice = 'phone' | 'computer';

export const getCalibrationDevice = (): CalibrationDevice =>
  /Android|iPhone|iPod/.test(navigator.userAgent) ? 'phone' : 'computer';

export type CalibrationTexts = {
  place: string;
  figure: string;
  quiet: string;
  silent: string;
};

export const useCalibrationTexts = (
  place: CalibrationPlace,
  device: CalibrationDevice,
): CalibrationTexts => {
  const { t } = useTranslation();
  const placeTexts: Record<
    CalibrationPlace,
    Record<CalibrationDevice, string>
  > = {
    headphones: {
      phone: t('pages.project.calibration.place.headphones.phone'),
      computer: t('pages.project.calibration.place.headphones.computer'),
    },
    speaker: {
      phone: t('pages.project.calibration.place.speaker.phone'),
      computer: t('pages.project.calibration.place.speaker.computer'),
    },
    unknown: {
      phone: t('pages.project.calibration.place.unknown.phone'),
      computer: t('pages.project.calibration.place.unknown.computer'),
    },
  };
  const headphoneFigures: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.figure.headphones.phone'),
    computer: t('pages.project.calibration.figure.headphones.computer'),
  };
  const microphoneFigures: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.figure.microphone.phone'),
    computer: t('pages.project.calibration.figure.microphone.computer'),
  };
  const quietTexts: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.quiet.headphones.phone'),
    computer: t('pages.project.calibration.quiet.headphones.computer'),
  };
  const silentTexts: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.silent.headphones.phone'),
    computer: t('pages.project.calibration.silent.headphones.computer'),
  };
  const headphones = place === 'headphones';
  return {
    place: placeTexts[place][device],
    figure: headphones ? headphoneFigures[device] : microphoneFigures[device],
    quiet: headphones
      ? quietTexts[device]
      : t('pages.project.calibration.quiet.output'),
    silent: headphones
      ? silentTexts[device]
      : t('pages.project.calibration.silent.output'),
  };
};
