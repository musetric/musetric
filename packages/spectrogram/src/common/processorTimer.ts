import {
  createCpuTimer,
  createGpuTimer,
  roundDuration,
} from './timer/index.js';

export const spectrumStages = [
  'sliceSamples',
  'fourierTransform',
  'magnitudify',
  'decibelify',
] as const;
const aggregateStages = ['fundamentalFrequency', 'remap'] as const;
const cpuRootLabels = [
  'configure',
  'writeBuffers',
  'createCommand',
  'submitCommand',
  'total',
] as const;
const gpuRootLabels = ['draw'] as const;
type GpuRootLabel = (typeof gpuRootLabels)[number];

export type SpectrumStage = (typeof spectrumStages)[number];

type AggregateStage = (typeof aggregateStages)[number];

export type GpuLabel = GpuRootLabel | SpectrumStage | AggregateStage;

const gpuLabels: GpuLabel[] = [
  ...gpuRootLabels,
  ...spectrumStages,
  ...aggregateStages,
];

type CpuRootLabel = (typeof cpuRootLabels)[number];

export type SpectrogramTimerLabel =
  | CpuRootLabel
  | GpuRootLabel
  | SpectrumStage
  | AggregateStage
  | 'other';

const createTimerLabels = (
  labels: readonly GpuLabel[],
): SpectrogramTimerLabel[] => [
  ...cpuRootLabels.filter((label) => label !== 'total'),
  ...labels,
  'other',
  'total',
];

export type SpectrogramProcessorMetrics = Record<string, number>;

const createFallbackMetricsLabels = (
  metrics: SpectrogramProcessorMetrics[],
): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const metric of metrics) {
    for (const label of Object.keys(metric)) {
      if (seen.has(label)) {
        continue;
      }
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
};

export const averageMetrics = (
  buffer: SpectrogramProcessorMetrics[],
): SpectrogramProcessorMetrics => {
  const labels = createFallbackMetricsLabels(buffer);
  return labels.reduce<SpectrogramProcessorMetrics>((acc, key) => {
    acc[key] = roundDuration(
      buffer.reduce((sum, metric) => sum + (metric[key] ?? 0), 0) /
        buffer.length,
    );
    return acc;
  }, {});
};

export type SpectrogramMarkers = {
  configure: <T extends (...args: never[]) => unknown>(fn: T) => T;
  writeBuffers: <T extends (...args: never[]) => unknown>(fn: T) => T;
  createCommand: <T extends (...args: never[]) => unknown>(fn: T) => T;
  submitCommand: <T extends (...args: never[]) => unknown>(fn: T) => T;
  total: <T extends (...args: never[]) => unknown>(fn: T) => T;
  getGpuMarker: (label: GpuLabel) => GPUComputePassTimestampWrites | undefined;
};

const createCpuMarkers = () =>
  cpuRootLabels.reduce(
    (acc, label) => {
      acc[label] = (fn) => fn;
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Pick<
      SpectrogramMarkers,
      'configure' | 'writeBuffers' | 'createCommand' | 'submitCommand' | 'total'
    >,
  );

export type SpectrogramProcessorTimer = {
  markers: SpectrogramMarkers;
  configure: () => void;
  resolve: (encoder: GPUCommandEncoder) => void;
  finish: () => Promise<void>;
  dispose: () => void;
};

export const createSpectrogramProcessorTimer = (
  device: GPUDevice,
  onMetrics?: (metrics: SpectrogramProcessorMetrics) => void,
): SpectrogramProcessorTimer => {
  if (!onMetrics) {
    return {
      markers: {
        ...createCpuMarkers(),
        getGpuMarker: () => undefined,
      },
      configure: () => undefined,
      resolve: () => undefined,
      finish: async () => {
        await Promise.resolve();
      },
      dispose: () => undefined,
    };
  }

  const cpu = createCpuTimer(cpuRootLabels);
  const timerLabels: SpectrogramTimerLabel[] = createTimerLabels(gpuLabels);
  const gpu = createGpuTimer(device, gpuLabels);

  const markers: SpectrogramMarkers = {
    ...cpu.markers,
    getGpuMarker: (label) => gpu.markers[label],
  };

  return {
    markers,
    configure: () => undefined,
    resolve: (encoder) => {
      gpu.resolve(encoder);
    },
    finish: async () => {
      const gpuMetrics = await gpu.read();
      if (!gpuMetrics) {
        return;
      }
      const cpuMetrics = cpu.read();
      const metrics: SpectrogramProcessorMetrics = {
        ...gpuMetrics,
        ...cpuMetrics,
        other: 0,
      };
      const gpuSum = gpuLabels.reduce((acc, key) => acc + metrics[key], 0);
      metrics.submitCommand = roundDuration(metrics.submitCommand - gpuSum);
      const sum = timerLabels
        .filter((label) => label !== 'other' && label !== 'total')
        .reduce((acc, key) => acc + (metrics[key] ?? 0), 0);
      metrics.other = roundDuration(metrics.total - sum);
      const sortedMetrics = timerLabels.reduce<SpectrogramProcessorMetrics>(
        (acc, key) => ({
          ...acc,
          [key]: metrics[key] ?? 0,
        }),
        {},
      );
      onMetrics(sortedMetrics);
    },
    dispose: () => {
      gpu.dispose();
    },
  };
};
