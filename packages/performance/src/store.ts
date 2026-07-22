import { type FourierMode } from '@musetric/fft';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  type BenchmarkParams,
  defaultBenchmarkParams,
  fourierModes,
  windowSizes,
} from './constants.js';
import { type BenchmarkData, type MetricsData } from './runBenchmarks.js';

const buildInitialData = (): BenchmarkData =>
  fourierModes.reduce(
    (acc, fourierMode) => {
      acc[fourierMode] = {};
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as BenchmarkData,
  );

export type Task = {
  fourierMode: FourierMode;
  windowSize: number;
};

const buildAllTasks = (): Task[] =>
  fourierModes.flatMap((fourierMode) =>
    windowSizes.map((windowSize) => ({ fourierMode, windowSize })),
  );

export const totalTasks = fourierModes.length * windowSizes.length;

export type ProcessingState = {
  params: BenchmarkParams;
  showFirst: boolean;
  showPercent: boolean;
  showDeviations: boolean;
  mode: FourierMode;

  data: BenchmarkData;
  toDo: Task[];
  epoch: number;

  setParam: <K extends keyof BenchmarkParams>(
    key: K,
    value: BenchmarkParams[K],
  ) => void;
  setShowFirst: (value: boolean) => void;
  setShowPercent: (value: boolean) => void;
  setShowDeviations: (value: boolean) => void;
  setMode: (value: FourierMode) => void;
  recordResult: (task: Task, taskEpoch: number, metrics: MetricsData) => void;
};

export const useProcessingStore = create<ProcessingState>()(
  subscribeWithSelector((set) => ({
    params: defaultBenchmarkParams,
    showFirst: false,
    showPercent: false,
    showDeviations: false,
    mode: fourierModes[0],

    data: buildInitialData(),
    toDo: buildAllTasks(),
    epoch: 0,

    setParam: (key, value) =>
      set((state) => ({
        params: { ...state.params, [key]: value },
        data: buildInitialData(),
        toDo: buildAllTasks(),
        epoch: state.epoch + 1,
      })),
    setShowFirst: (showFirst) => set({ showFirst }),
    setShowPercent: (showPercent) => set({ showPercent }),
    setShowDeviations: (showDeviations) => set({ showDeviations }),
    setMode: (mode) => set({ mode }),
    recordResult: (task, taskEpoch, metrics) =>
      set((state) => {
        if (taskEpoch !== state.epoch) return state;
        const [head] = state.toDo;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!head) return state;
        if (
          head.fourierMode !== task.fourierMode ||
          head.windowSize !== task.windowSize
        ) {
          return state;
        }
        return {
          data: {
            ...state.data,
            [task.fourierMode]: {
              ...state.data[task.fourierMode],
              [task.windowSize]: metrics,
            },
          },
          toDo: state.toDo.slice(1),
        };
      }),
  })),
);
