import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../../audioSession/engineAudioSession.js';

const noop = (): void => undefined;

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const fake = <Type>(value: object): Type => value as Type;

export type Microphone = {
  open: () => void;
};

export const createMicrophone = (): {
  session: EngineAudioSession;
} & Microphone => {
  let opened: (() => void) | undefined = undefined;
  let openedEarly = false;
  const microphone: EngineMicrophone = {
    getSettings: () => ({}),
    getMeasuredInputLatency: () => 0,
    whenInputLatencyMeasured: async () => Promise.resolve(),
    createSource: () => fake<AudioNode>({ connect: noop, disconnect: noop }),
  };
  return {
    session: {
      openMicrophone: async () =>
        new Promise<EngineMicrophone>((resolve) => {
          opened = () => {
            resolve(microphone);
          };
          if (openedEarly) {
            openedEarly = false;
            opened();
          }
        }),
      closeMicrophone: noop,
      enumerateDevices: async () => Promise.resolve([]),
      subscribeDevices: () => noop,
      readMicrophoneDenial: () => undefined,
      canOpenMicrophoneSettings: () => false,
      openMicrophoneSettings: noop,
    },
    open: () => {
      if (opened) {
        opened();
        opened = undefined;
      } else {
        openedEarly = true;
      }
    },
  };
};
