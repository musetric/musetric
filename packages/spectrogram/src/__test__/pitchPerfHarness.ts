import {
  type BenchStats,
  computeBenchStats,
  defaultBenchStatsConfig,
  selectBenchRunsPerSample,
} from '@musetric/utils';
import { toSpectrogramSource } from '../common/source.js';
import { createGpuTimer } from '../common/timer/gpu.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { createSpectrogramFundamentalFrequencyCell } from '../fundamentalFrequency/index.js';
import {
  createPitchSettings,
  type PitchSettings,
} from '../fundamentalFrequency/settings.es.js';
import { playback60Fps } from './bench.es.js';
import {
  type PitchPerfMetric,
  type PitchPerfRow,
  type PitchPerfTable,
} from './pitchPerf.es.js';

const kernelBenchConfig = { ...defaultBenchStatsConfig, targetSampleMs: 10 };

const sampleLabels = Array.from(
  { length: kernelBenchConfig.batchSize },
  (_, index) => `sample${index}`,
);

type Dispatch = (pass: GPUComputePassEncoder) => void;

const runBatch = async (
  device: GPUDevice,
  dispatchOnce: Dispatch,
  runsPerSample: number,
): Promise<number[]> => {
  const timer = createGpuTimer(device, sampleLabels);
  const encoder = device.createCommandEncoder();
  for (const label of sampleLabels) {
    const pass = encoder.beginComputePass({
      timestampWrites: timer.markers[label],
    });
    for (let run = 0; run < runsPerSample; run += 1) {
      dispatchOnce(pass);
    }
    pass.end();
  }
  timer.resolve(encoder);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const durations = await timer.read();
  timer.dispose();
  if (!durations) {
    throw new Error('the GPU timer could not be read');
  }
  return sampleLabels.map((label) => durations[label] / runsPerSample);
};

export const measureDispatch = async (
  device: GPUDevice,
  dispatchOnce: Dispatch,
): Promise<BenchStats> => {
  const values: number[] = [];
  let runsPerSample = 1;
  for (let tryIndex = 0; tryIndex < kernelBenchConfig.maxTries; tryIndex += 1) {
    const durations = await runBatch(device, dispatchOnce, runsPerSample);
    if (tryIndex === 0) {
      runsPerSample = selectBenchRunsPerSample(durations, kernelBenchConfig);
      continue;
    }
    values.push(...durations);
    if (
      computeBenchStats(values, kernelBenchConfig).cv <=
      kernelBenchConfig.stableCvPercent
    ) {
      break;
    }
  }
  return computeBenchStats(values, kernelBenchConfig);
};

const synthesizeVoice = (
  length: number,
  sampleRate: number,
): Float32Array<ArrayBuffer> =>
  Float32Array.from({ length }, (_, index) => {
    const phase = (2 * Math.PI * 220 * index) / sampleRate;
    let value = 0;
    for (let harmonic = 1; harmonic <= 10; harmonic += 1) {
      value += Math.sin(harmonic * phase) / harmonic;
    }
    return 0.1 * value;
  });

const playbackFrames = (settings: PitchSettings): number =>
  Math.ceil(
    (playback60Fps.framesPerRender * settings.sampleRate) /
      defaultSpectrogramConfig.sampleRate /
      settings.hop,
  );

export const measureKernelRow = async (
  device: GPUDevice,
  frames: number,
): Promise<PitchPerfRow> => {
  const { sampleRate, fourierMode } = defaultSpectrogramConfig;
  const settings = createPitchSettings(sampleRate);
  const windowCount =
    frames - settings.historyFrames - settings.lookaheadFrames - 3;
  const baseColumn = settings.historyFrames + 2;
  const cell = createSpectrogramFundamentalFrequencyCell(device);
  try {
    const pitch = cell.get({
      sampleRate,
      fourierMode,
      columnStep: settings.hop,
      windowCount,
    });
    const samples = synthesizeVoice(
      (baseColumn + windowCount + 400) * settings.hop,
      sampleRate,
    );
    const prepare = (shift: number): void => {
      pitch.prepare({
        source: toSpectrogramSource(samples),
        projection: { baseColumn: baseColumn + shift, baseSlot: shift },
        trackProgress: 0,
        truncated: false,
        invalidations: [],
      });
    };
    prepare(0);
    const metrics: PitchPerfMetric[] = [];
    const measure = async (
      label: string,
      dispatchOnce: Dispatch,
      reference?: string,
    ): Promise<void> => {
      const stats = await measureDispatch(device, dispatchOnce);
      metrics.push({ label, ...stats, reference });
    };
    const fft = pitch.stages.find((stage) => stage.label === 'fft');
    if (fft) {
      await measure('fft', fft.dispatch);
    }
    for (const stage of pitch.stages) {
      if (stage.label !== 'fft') {
        await measure(stage.label, stage.dispatch, 'fft');
      }
    }
    await measure('pitch', pitch.dispatch, 'fft');
    prepare(playbackFrames(settings));
    await measure('pitch frame', pitch.dispatch, 'pitch');
    return {
      spectrum: `${settings.windowSize}·${settings.fftSize / settings.windowSize}`,
      metrics,
    };
  } finally {
    cell.dispose();
  }
};

export const measureKernelTable = async (
  device: GPUDevice,
  frames: number,
): Promise<PitchPerfTable> => ({
  columns: frames,
  frameColumns: playbackFrames(
    createPitchSettings(defaultSpectrogramConfig.sampleRate),
  ),
  rows: [await measureKernelRow(device, frames)],
});
