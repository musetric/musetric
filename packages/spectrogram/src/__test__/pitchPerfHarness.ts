import { createFourierCell } from '@musetric/fft/gpu';
import {
  type BenchStats,
  computeBenchStats,
  defaultBenchStatsConfig,
  selectBenchRunsPerSample,
} from '@musetric/utils';
import { expandColumnRanges } from '../common/columnRanges.js';
import {
  computeColumnStep,
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';
import { createGpuTimer } from '../common/timer/gpu.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  createSpectrogramFundamentalFrequencyCell,
  type FundamentalFrequencyStage,
} from '../fundamentalFrequency/index.js';
import { playback60Fps } from './bench.es.js';
import { buildConfig, extendConfig } from './common.js';
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

const createSpectrumData = (
  length: number,
  offset: number,
  scale: number,
): Float32Array<ArrayBuffer> =>
  Float32Array.from(
    { length },
    (_, index) => offset + scale * Math.sin(index / 16),
  );

export type PitchKernelSpectrum = {
  windowSize: number;
  zeroPaddingFactor: 1 | 2 | 4;
};

export type PitchKernelCase = {
  spectrum: PitchKernelSpectrum;
  columns: number;
};

const buildKernelConfig = (kernelCase: PitchKernelCase): ExtSpectrogramConfig =>
  extendConfig(
    buildConfig({
      windowSize: kernelCase.spectrum.windowSize,
      zeroPaddingFactor: kernelCase.spectrum.zeroPaddingFactor,
      viewSize: { width: kernelCase.columns, height: 1 },
    }),
  );

export const frameColumnsOf = (columns: number): number =>
  Math.ceil(
    playback60Fps.framesPerRender /
      computeColumnStep({
        visibleTime: defaultSpectrogramConfig.visibleTime,
        sampleRate: defaultSpectrogramConfig.sampleRate,
        windowCount: columns,
      }),
  );

const frameRange = (config: ExtSpectrogramConfig): SpectrogramColumnRange => {
  const columnCount = frameColumnsOf(config.windowCount);
  return {
    screenBase: config.windowCount - columnCount,
    slotOffset: 0,
    columnCount,
  };
};

const quarterRange = (
  config: ExtSpectrogramConfig,
): SpectrogramColumnRange => ({
  screenBase: Math.floor((config.windowCount * 3) / 8),
  slotOffset: 0,
  columnCount: Math.floor(config.windowCount / 4),
});

const stageRanges = (
  config: ExtSpectrogramConfig,
  stage: FundamentalFrequencyStage,
  range: SpectrogramColumnRange | undefined,
): (SpectrogramColumnRange | undefined)[] => {
  if (!range) {
    return [undefined];
  }
  if (stage.radius > 0) {
    return expandColumnRanges(config, 0, [range], stage.radius);
  }
  return [range];
};

type KernelSetup = {
  config: ExtSpectrogramConfig;
  signal: GPUBuffer;
  magnitude: GPUBuffer;
};

const createKernelSetup = (
  device: GPUDevice,
  kernelCase: PitchKernelCase,
): KernelSetup => {
  const config = buildKernelConfig(kernelCase);
  const fftSize = config.windowSize * config.zeroPaddingFactor;
  const signalLength = (fftSize + 2) * config.windowCount;
  const magnitudeLength = (fftSize / 2) * config.windowCount;
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const signal = device.createBuffer({
    size: signalLength * Float32Array.BYTES_PER_ELEMENT,
    usage,
  });
  const magnitude = device.createBuffer({
    size: magnitudeLength * Float32Array.BYTES_PER_ELEMENT,
    usage,
  });
  device.queue.writeBuffer(
    signal,
    0,
    createSpectrumData(signalLength, -30, 20),
  );
  device.queue.writeBuffer(
    magnitude,
    0,
    createSpectrumData(magnitudeLength, 0.5, 0.5),
  );
  return { config, signal, magnitude };
};

export const measureKernelRow = async (
  device: GPUDevice,
  kernelCase: PitchKernelCase,
): Promise<PitchPerfRow> => {
  const setup = createKernelSetup(device, kernelCase);
  const { config } = setup;
  const fourierCell = createFourierCell(device);
  const fundamentalCell = createSpectrogramFundamentalFrequencyCell(device);
  try {
    const fourier = fourierCell.get({ signal: setup.signal, config });
    const fundamental = fundamentalCell.get({
      signal: setup.signal,
      magnitude: setup.magnitude,
      config,
    });
    const metrics: PitchPerfMetric[] = [];
    const measure = async (
      label: string,
      dispatchOnce: Dispatch,
      reference?: string,
    ): Promise<void> => {
      const stats = await measureDispatch(device, dispatchOnce);
      metrics.push({ label, ...stats, reference });
    };
    const dispatchPitch =
      (range?: SpectrogramColumnRange): Dispatch =>
      (pass) => {
        for (const stage of fundamental.stages) {
          for (const stageRange of stageRanges(config, stage, range)) {
            stage.dispatch(pass, stageRange);
          }
        }
      };
    const frame = frameRange(config);
    await measure('fft', (pass) => {
      fourier.dispatch(pass);
    });
    await measure(
      'fft frame',
      (pass) => {
        fourier.dispatch(pass, {
          batchOffset: frame.screenBase,
          batchCount: frame.columnCount,
        });
      },
      'fft',
    );
    for (const stage of fundamental.stages) {
      await measure(
        stage.label,
        (pass) => {
          stage.dispatch(pass);
        },
        'fft',
      );
    }
    await measure('pitch', dispatchPitch(), 'fft');
    await measure(
      'pitch quarter',
      dispatchPitch(quarterRange(config)),
      'pitch',
    );
    await measure('pitch frame', dispatchPitch(frame), 'pitch');
    return {
      spectrum: `${config.windowSize}·${config.zeroPaddingFactor}`,
      metrics,
    };
  } finally {
    fundamentalCell.dispose();
    fourierCell.dispose();
    setup.signal.destroy();
    setup.magnitude.destroy();
  }
};

export const measureKernelTable = async (
  device: GPUDevice,
  columns: number,
  spectra: readonly PitchKernelSpectrum[],
): Promise<PitchPerfTable> => {
  const rows: PitchPerfRow[] = [];
  for (const spectrum of spectra) {
    rows.push(await measureKernelRow(device, { spectrum, columns }));
  }
  return { columns, frameColumns: frameColumnsOf(columns), rows };
};
