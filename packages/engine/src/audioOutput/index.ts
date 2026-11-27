const measure = import.meta.env.frontendMeasure === 'true';

const createMeasureGain = (context: AudioContext, value: number) => {
  const node = context.createGain();
  node.gain.value = value;
  node.connect(context.destination);
  return node;
};

type SetSinkId = (sinkId: string) => Promise<void>;

type AudioContextWithSetSinkId = AudioContext & {
  setSinkId?: SetSinkId;
};

const getAudioContextSetSinkId = (
  context: AudioContext,
): SetSinkId | undefined => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const contextWithSetSinkId = context as AudioContextWithSetSinkId;
  if (contextWithSetSinkId.setSinkId) {
    return contextWithSetSinkId.setSinkId.bind(contextWithSetSinkId);
  }

  return undefined;
};

export type EngineAudioOutput = {
  getOutputNode: () => AudioNode;
  supportsDeviceSelection: boolean;
  getDeviceId: () => string | undefined;
  setDeviceId: (deviceId: string | undefined) => Promise<void>;
  play: () => Promise<void>;
  attach: (context: AudioContext) => Promise<void>;
};

export const createEngineAudioOutput = (
  initialContext: AudioContext,
  routedBySystem: boolean,
): EngineAudioOutput => {
  let context = initialContext;
  let deviceId: string | undefined = undefined;
  let measureGain = measure ? createMeasureGain(context, 1) : undefined;

  const applyDeviceId = async (nextDeviceId: string | undefined) => {
    const setSinkId = getAudioContextSetSinkId(context);
    if (!setSinkId) {
      return;
    }
    await setSinkId(nextDeviceId ?? '');
    deviceId = nextDeviceId;
  };

  return {
    getOutputNode: () => measureGain ?? context.destination,
    supportsDeviceSelection:
      !routedBySystem && getAudioContextSetSinkId(context) !== undefined,
    getDeviceId: () => deviceId,
    setDeviceId: applyDeviceId,
    play: async () => Promise.resolve(),
    attach: async (next) => {
      context = next;
      measureGain &&= createMeasureGain(next, measureGain.gain.value);
      if (deviceId !== undefined) {
        await applyDeviceId(deviceId);
      }
    },
  };
};
