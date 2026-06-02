import { allTrackKeys, type TrackKey } from '../config.cross.js';
import {
  createCpuTimer,
  createGpuTimer,
  roundDuration,
} from './timer/index.js';

export const spectrogramLaneStages = [
  'sliceSamples',
  'windowing',
  'fourierReverse',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
] as const;
export type SpectrogramLaneStage = (typeof spectrogramLaneStages)[number];

export type SpectrogramLaneTimerLabel = `${TrackKey}.${SpectrogramLaneStage}`;

const cpuRootLabels = [
  'configure',
  'writeBuffers',
  'createCommand',
  'submitCommand',
  'total',
] as const;
type CpuRootLabel = (typeof cpuRootLabels)[number];

const gpuRootLabels = ['draw'] as const;
type GpuRootLabel = (typeof gpuRootLabels)[number];

type GpuLabel = GpuRootLabel | SpectrogramLaneTimerLabel;

export type SpectrogramTimerLabel =
  | CpuRootLabel
  | GpuRootLabel
  | SpectrogramLaneTimerLabel
  | 'other';

export type SpectrogramProcessorMetrics = Record<SpectrogramTimerLabel, number>;

const laneLabels: SpectrogramLaneTimerLabel[] = allTrackKeys.flatMap((key) =>
  spectrogramLaneStages.map<SpectrogramLaneTimerLabel>(
    (stage) => `${key}.${stage}`,
  ),
);

const gpuLabels: readonly GpuLabel[] = [...gpuRootLabels, ...laneLabels];

export const spectrogramTimerLabels: readonly SpectrogramTimerLabel[] = [
  ...cpuRootLabels.filter((label) => label !== 'total'),
  ...gpuRootLabels,
  ...laneLabels,
  'other',
  'total',
];

const create = (device: GPUDevice) => ({
  gpu: createGpuTimer<readonly GpuLabel[]>(device, gpuLabels),
  cpu: createCpuTimer(cpuRootLabels),
});

type Timer = ReturnType<typeof create>;

export type SpectrogramMarkers = Partial<Timer['gpu']['markers']> &
  Timer['cpu']['markers'];

export type SpectrogramProcessorTimer = {
  markers: SpectrogramMarkers;
  resolve: (encoder: GPUCommandEncoder) => void;
  finish: () => Promise<void>;
  dispose: () => void;
};

export const averageMetrics = (
  buffer: SpectrogramProcessorMetrics[],
): SpectrogramProcessorMetrics =>
  spectrogramTimerLabels.reduce<SpectrogramProcessorMetrics>(
    (acc, key) => {
      acc[key] = roundDuration(
        buffer.reduce((sum, m) => sum + m[key], 0) / buffer.length,
      );
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as SpectrogramProcessorMetrics,
  );

export const createSpectrogramProcessorTimer = (
  device: GPUDevice,
  onMetrics?: (metrics: SpectrogramProcessorMetrics) => void,
): SpectrogramProcessorTimer => {
  if (!onMetrics) {
    return {
      markers: cpuRootLabels.reduce(
        (acc, label) => {
          acc[label] = (fn) => fn;
          return acc;
        },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as SpectrogramMarkers,
      ),
      resolve: () => {
        /** Nothing */
      },
      finish: async () => {
        /** Nothing */
      },
      dispose: () => {
        /** Nothing */
      },
    };
  }

  const timer = create(device);
  const markers: SpectrogramMarkers = {
    ...timer.gpu.markers,
    ...timer.cpu.markers,
  };

  const processorTimer: SpectrogramProcessorTimer = {
    markers,
    resolve: timer.gpu.resolve,
    finish: async () => {
      const gpuMetrics = await timer.gpu.read();
      const cpuMetrics = timer.cpu.read();
      const metrics: SpectrogramProcessorMetrics = {
        ...gpuMetrics,
        ...cpuMetrics,
        other: 0,
      };
      const gpuSum = gpuLabels.reduce((acc, key) => acc + metrics[key], 0);
      metrics.submitCommand = roundDuration(metrics.submitCommand - gpuSum);
      const sum = spectrogramTimerLabels
        .filter((label) => label !== 'other' && label !== 'total')
        .reduce((acc, key) => acc + metrics[key], 0);
      metrics.other = roundDuration(metrics.total - sum);
      const sortedMetrics =
        spectrogramTimerLabels.reduce<SpectrogramProcessorMetrics>(
          (acc, key) => ({
            ...acc,
            [key]: metrics[key],
          }),
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          {} as SpectrogramProcessorMetrics,
        );
      onMetrics(sortedMetrics);
    },
    dispose: timer.gpu.dispose,
  };

  return processorTimer;
};
