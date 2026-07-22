type SetSinkId = (sinkId: string) => Promise<void>;

const getAudioContextSetSinkId = (
  context: AudioContext,
): SetSinkId | undefined => {
  const value: unknown = Reflect.get(context, 'setSinkId');
  if (typeof value === 'function') {
    return async (sinkId) => {
      await Reflect.apply(value, context, [sinkId]);
    };
  }

  return undefined;
};

export type EngineAudioOutput = {
  outputNode: AudioNode;
  supportsDeviceSelection: boolean;
  getDeviceId: () => string | undefined;
  setDeviceId: (deviceId: string | undefined) => Promise<void>;
  play: () => Promise<void>;
};

export const createEngineAudioOutput = (
  context: AudioContext,
): EngineAudioOutput => {
  const setSinkId = getAudioContextSetSinkId(context);
  let deviceId: string | undefined = undefined;

  if (!setSinkId) {
    return {
      outputNode: context.destination,
      supportsDeviceSelection: false,
      getDeviceId: () => deviceId,
      setDeviceId: async () => Promise.resolve(),
      play: async () => Promise.resolve(),
    };
  }

  return {
    outputNode: context.destination,
    supportsDeviceSelection: true,
    getDeviceId: () => deviceId,
    setDeviceId: async (nextDeviceId) => {
      await setSinkId(nextDeviceId ?? '');
      deviceId = nextDeviceId;
    },
    play: async () => Promise.resolve(),
  };
};
