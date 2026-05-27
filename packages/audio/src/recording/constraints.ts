export type CreateMicrophoneAudioConstraintsOptions = {
  deviceId?: string;
  sampleRate: number;
};

export const createMicrophoneAudioConstraints = (
  options: CreateMicrophoneAudioConstraintsOptions,
): MediaTrackConstraints => {
  const constraints: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    sampleRate: { ideal: options.sampleRate },
  };

  if (options.deviceId) {
    constraints.deviceId = {
      exact: options.deviceId,
    };
  }

  return constraints;
};
