type AudioSessionType = 'auto' | 'playback';

type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: AudioSessionType };
};

export type EngineAudioSession = {
  openMicrophone: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  closeMicrophone: (stream: MediaStream) => void;
};

export const createEngineAudioSession = (): EngineAudioSession => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const { audioSession } = navigator as NavigatorWithAudioSession;
  const openStreams = new Set<MediaStream>();
  let openingStreams = 0;

  const apply = () => {
    if (!audioSession) {
      return;
    }
    audioSession.type =
      openStreams.size + openingStreams > 0 ? 'auto' : 'playback';
  };

  apply();

  return {
    openMicrophone: async (constraints) => {
      openingStreams += 1;
      apply();
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        openStreams.add(stream);
        return stream;
      } finally {
        openingStreams -= 1;
        apply();
      }
    },
    closeMicrophone: (stream) => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      openStreams.delete(stream);
      apply();
    },
  };
};
