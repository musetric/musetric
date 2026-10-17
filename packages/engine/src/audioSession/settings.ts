import { type MicrophoneDenial } from '../state.js';

const windowsSettings = 'ms-settings:privacy-microphone';
const macSettings =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

type AndroidSettings = {
  openAppSettings: () => void;
};

type SettingsWindow = Window & {
  MusetricSettings?: AndroidSettings;
};

const readAndroidSettings = (): AndroidSettings | undefined => {
  const target: SettingsWindow = window;
  return target.MusetricSettings;
};

const readSystemSettings = (): string | undefined => {
  const { userAgent, maxTouchPoints } = navigator;
  if (userAgent.includes('Windows')) {
    return windowsSettings;
  }
  if (userAgent.includes('Macintosh') && maxTouchPoints <= 1) {
    return macSettings;
  }
  return undefined;
};

export const readWebMicrophoneDenial = (
  error: unknown,
): MicrophoneDenial | undefined => {
  if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
    return undefined;
  }
  if (readAndroidSettings()) {
    return 'app';
  }
  return error.message.toLowerCase().includes('system') ? 'system' : 'page';
};

export const canOpenWebMicrophoneSettings = (denial: MicrophoneDenial) =>
  denial === 'app'
    ? readAndroidSettings() !== undefined
    : denial === 'system' && readSystemSettings() !== undefined;

export const openWebMicrophoneSettings = (denial: MicrophoneDenial) => {
  if (denial === 'app') {
    readAndroidSettings()?.openAppSettings();
    return;
  }
  const settings = readSystemSettings();
  if (denial === 'system' && settings) {
    window.location.assign(settings);
  }
};
