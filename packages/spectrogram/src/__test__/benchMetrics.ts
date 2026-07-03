import { computeBenchStats } from '@musetric/utils';
import { type SpectrogramProcessorMetrics } from '../common/processorTimer.js';
import {
  spectrogramBenchConfig,
  type SpectrogramBenchMetric,
} from './bench.es.js';

export const pilotSampleCount = 8;

export const gpuComputeLabels = [
  'sliceSamples',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
] as const;

export const averageMetrics = (
  metricsList: SpectrogramProcessorMetrics[],
): SpectrogramProcessorMetrics => {
  if (metricsList.length < 1) {
    return {};
  }
  const labels = new Set<string>();
  for (const metrics of metricsList) {
    for (const label of Object.keys(metrics)) {
      labels.add(label);
    }
  }
  const result: SpectrogramProcessorMetrics = {};
  for (const label of labels) {
    let sum = 0;
    for (const metrics of metricsList) {
      sum += metrics[label] ?? 0;
    }
    result[label] = sum / metricsList.length;
  }
  return result;
};

export const aggregateMetrics = (
  samples: SpectrogramProcessorMetrics[],
): SpectrogramBenchMetric[] => {
  const labels = new Set<string>();
  for (const metrics of samples) {
    for (const label of Object.keys(metrics)) {
      labels.add(label);
    }
  }
  return [...labels].map((label) => {
    const values = samples.map((metrics) => metrics[label] ?? Number.NaN);
    const { mean, cv } = computeBenchStats(values, spectrogramBenchConfig);
    return { label, mean, cv };
  });
};

export const addDerivedMetrics = (
  metrics: SpectrogramProcessorMetrics,
): SpectrogramProcessorMetrics => {
  const gpuCompute = gpuComputeLabels.reduce(
    (sum, label) => sum + (metrics[label] ?? 0),
    0,
  );
  return {
    ...metrics,
    gpuCompute,
    gpuWork: gpuCompute + metrics.draw,
  };
};
