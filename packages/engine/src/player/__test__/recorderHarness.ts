import { type EngineOutputClock } from '../../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../../audioSession/engineAudioSession.js';
import { createStore } from '../../common/store.js';
import { initialEngineState } from '../../ownState.js';
import { type EngineProject } from '../../project/index.js';
import { type EnginePlayback } from '../playback.js';
import { createEnginePosition } from '../position.js';
import { createEngineRecorder, type EngineRecorder } from '../recorder.js';
import { createEngineSeeks } from '../seeks.js';
import { createEngineStubPlayback } from '../stubPlayback.js';

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
    setActive: noop,
    attach: noop,
  };
  const finished: number[] = [];
  let started = 0;
  const project = fake<EngineProject>({
    startRecordingStream: () => {
      started += 1;
    },
    finishRecordingStream: async (_takeId: string, sequence: number) => {
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
    seeks: createEngineSeeks(),
    endTake: noop,
    getProject: () => project,
    getEnginePlayback: () => enginePlayback,
  });
  return { recorder, finished, started: () => started };
};
