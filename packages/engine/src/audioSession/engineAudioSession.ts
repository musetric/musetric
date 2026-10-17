import { type RecordingInputSettings } from '@musetric/audio/recording';

export type EngineMicrophone = {
  getSettings: () => RecordingInputSettings;
  getMeasuredInputLatency: () => number | undefined;
  whenInputLatencyMeasured: () => Promise<void>;
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
};

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
