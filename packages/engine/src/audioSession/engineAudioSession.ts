import { type RecordingInputSettings } from '@musetric/audio/recording';
import { type EngineOutputVolume, type MicrophoneDenial } from '../state.js';

export type EngineMicrophone = {
  getSettings: () => RecordingInputSettings;
  getMeasuredInputLatency: () => number | undefined;
  whenInputLatencyMeasured: () => Promise<void>;
  exactRoundTripLatency?: number;
  outputLatency?: number;
  createSource: () => AudioNode;
};

export type EngineMicrophoneRequest = {
  deviceId?: string;
};

export type EngineAudioSession = {
  openMicrophone: (
    request: EngineMicrophoneRequest,
  ) => Promise<EngineMicrophone>;
  closeMicrophone: (microphone: EngineMicrophone) => void;
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  subscribeDevices: (listener: () => void) => () => void;
  checkMicrophoneAccess?: () => Promise<boolean>;
  readOutputVolume?: () => Promise<EngineOutputVolume>;
  writeOutputVolume?: (volume: number) => Promise<EngineOutputVolume>;
  readMicrophoneDenial: (error: unknown) => MicrophoneDenial | undefined;
  canOpenMicrophoneSettings: (denial: MicrophoneDenial) => boolean;
  openMicrophoneSettings: (denial: MicrophoneDenial) => void;
};

export const microphoneAccessDenied = 'microphone-access-denied';

type AudioSessionType = 'auto' | 'playback';

type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: AudioSessionType };
};

export const setAudioSessionType = (type: AudioSessionType) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const { audioSession } = navigator as NavigatorWithAudioSession;
  if (audioSession) {
    audioSession.type = type;
  }
};
