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

export type CalibrationDevice = 'phone' | 'tablet' | 'computer';

export const getCalibrationDevice = (): CalibrationDevice => {
  const agent = navigator.userAgent;
  if (
    /iPad/.test(agent) ||
    (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  ) {
    return 'tablet';
  }
  if (/iPhone|iPod/.test(agent) || /Android.*Mobile/.test(agent)) {
    return 'phone';
  }
  return /Android/.test(agent) ? 'tablet' : 'computer';
};

const getMicrophoneEdge = (device: CalibrationDevice, inputLabel: string) => {
  if (/\(top\)/i.test(inputLabel)) {
    return 'top';
  }
  if (/\(bottom\)/i.test(inputLabel)) {
    return 'bottom';
  }
  return device === 'phone' ? 'bottom' : 'top';
};

export type CalibrationSpot =
  'phoneBottom' | 'phoneTop' | 'tabletTop' | 'tabletBottom' | 'computer';

export const getCalibrationSpot = (
  device: CalibrationDevice,
  inputLabel: string,
): CalibrationSpot => {
  const edge = getMicrophoneEdge(device, inputLabel);
  if (device === 'computer') {
    return 'computer';
  }
  if (device === 'phone') {
    return edge === 'top' ? 'phoneTop' : 'phoneBottom';
  }
  return edge === 'top' ? 'tabletTop' : 'tabletBottom';
};

export type CalibrationTexts = {
  place: string;
  figure: string;
  quiet: string;
  silent: string;
};

export const useCalibrationTexts = (
  place: CalibrationPlace,
  device: CalibrationDevice,
  spot: CalibrationSpot,
): CalibrationTexts => {
  const { t } = useTranslation();
  const headphonePlaces: Record<CalibrationSpot, string> = {
    phoneBottom: t('pages.project.calibration.place.headphones.phoneBottom'),
    phoneTop: t('pages.project.calibration.place.headphones.phoneTop'),
    tabletTop: t('pages.project.calibration.place.headphones.tabletTop'),
    tabletBottom: t('pages.project.calibration.place.headphones.tabletBottom'),
    computer: t('pages.project.calibration.place.headphones.computer'),
  };
  const speakerPlaces: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.place.speaker.phone'),
    tablet: t('pages.project.calibration.place.speaker.tablet'),
    computer: t('pages.project.calibration.place.speaker.computer'),
  };
  const unknownPlaces: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.place.unknown.phone'),
    tablet: t('pages.project.calibration.place.unknown.tablet'),
    computer: t('pages.project.calibration.place.unknown.computer'),
  };
  const headphoneFigures: Record<CalibrationSpot, string> = {
    phoneBottom: t('pages.project.calibration.figure.headphones.phoneBottom'),
    phoneTop: t('pages.project.calibration.figure.headphones.phoneTop'),
    tabletTop: t('pages.project.calibration.figure.headphones.tabletTop'),
    tabletBottom: t('pages.project.calibration.figure.headphones.tabletBottom'),
    computer: t('pages.project.calibration.figure.headphones.computer'),
  };
  const microphoneFigures: Record<CalibrationSpot, string> = {
    phoneBottom: t('pages.project.calibration.figure.microphone.phoneBottom'),
    phoneTop: t('pages.project.calibration.figure.microphone.phoneTop'),
    tabletTop: t('pages.project.calibration.figure.microphone.tabletTop'),
    tabletBottom: t('pages.project.calibration.figure.microphone.tabletBottom'),
    computer: t('pages.project.calibration.figure.microphone.computer'),
  };
  const quietTexts: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.quiet.headphones.phone'),
    tablet: t('pages.project.calibration.quiet.headphones.tablet'),
    computer: t('pages.project.calibration.quiet.headphones.computer'),
  };
  const silentTexts: Record<CalibrationDevice, string> = {
    phone: t('pages.project.calibration.silent.headphones.phone'),
    tablet: t('pages.project.calibration.silent.headphones.tablet'),
    computer: t('pages.project.calibration.silent.headphones.computer'),
  };
  const places: Record<CalibrationPlace, string> = {
    headphones: headphonePlaces[spot],
    speaker: speakerPlaces[device],
    unknown: unknownPlaces[device],
  };
  const headphones = place === 'headphones';
  return {
    place: places[place],
    figure: headphones ? headphoneFigures[spot] : microphoneFigures[spot],
    quiet: headphones
      ? quietTexts[device]
      : t('pages.project.calibration.quiet.output'),
    silent: headphones
      ? silentTexts[device]
      : t('pages.project.calibration.silent.output'),
  };
};
