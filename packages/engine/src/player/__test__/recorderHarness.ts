import { type EngineOutputClock } from '../../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../../audioSession/engineAudioSession.js';
import { createStore } from '../../common/store.js';
import { type EngineDecoder } from '../../decoder/index.js';
import { initialEngineState } from '../../state.js';
import { createEngineStubPlayback, type EnginePlayback } from '../playback.js';
import { createEnginePosition } from '../position.js';
import { createEngineRecorder, type EngineRecorder } from '../recorder.js';

const noop = (): void => undefined;

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const fake = <Type>(value: object): Type => value as Type;

const createNode = () => ({ connect: noop, disconnect: noop });

export type RecorderHarness = {
  recorder: EngineRecorder;
  finished: number[];
  started: () => number;
};

export const createRecorderHarness = (
  playback: Partial<EnginePlayback>,
): RecorderHarness => {
  const microphone: EngineMicrophone = {
    getSettings: () => ({}),
    getMeasuredInputLatency: () => undefined,
    whenInputLatencyMeasured: async () => Promise.resolve(),
    createSource: () => fake<AudioNode>(createNode()),
  };
  const audioSession: EngineAudioSession = {
    openMicrophone: async () => Promise.resolve(microphone),
    closeMicrophone: noop,
    enumerateDevices: async () => Promise.resolve([]),
    subscribeDevices: () => noop,
    readMicrophoneDenial: () => undefined,
    canOpenMicrophoneSettings: () => false,
    openMicrophoneSettings: noop,
  };
  const outputClock: EngineOutputClock = {
    read: () => undefined,
    subscribe: () => noop,
    whenSettled: async () => Promise.resolve(),
    wake: async () => Promise.resolve(),
  };
  const finished: number[] = [];
  let started = 0;
  const decoder = fake<EngineDecoder>({
    startRecordingStream: () => {
      started += 1;
    },
    finishRecordingStream: async (sequence: number) => {
      finished.push(sequence);
      return Promise.resolve();
    },
  });
  const enginePlayback = { ...createEngineStubPlayback(), ...playback };
  const recorder = createEngineRecorder({
    context: fake<AudioContext>({
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({
        ...createNode(),
        gain: { value: 1, setValueAtTime: noop },
      }),
    }),
    outputClock,
    audioSession,
    store: createStore(initialEngineState),
    position: createEnginePosition(),
    getDecoder: () => decoder,
    getEnginePlayback: () => enginePlayback,
  });
  return { recorder, finished, started: () => started };
};
