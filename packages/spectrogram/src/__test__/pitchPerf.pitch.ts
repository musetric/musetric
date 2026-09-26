import { createGpuContext } from '@musetric/utils/gpu';
import { inject, it } from 'vitest';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  fullMount,
  playback60Fps,
  type SpectrogramBenchScenario,
} from './bench.es.js';
import { type BenchDriver } from './benchDriver.js';
import { measureWallDriver, warmDriver } from './benchRunner.js';
import { type PitchExtractRequest } from './pitchAccuracy.es.js';
import {
  type ForeignProbeReport,
  formatPitchPerfMarkdown,
  type PitchPerfProbe,
  type PitchPerfRender,
  type PitchPerfResult,
  type PitchPerfTable,
} from './pitchPerf.es.js';
import {
  measureKernelTable,
  type PitchKernelSpectrum,
} from './pitchPerfHarness.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    pitchPerf?: PitchExtractRequest;
  }
}

const kernelColumns = [512, 1920];
const kernelSpectra: PitchKernelSpectrum[] = [
  { windowSize: 2048, zeroPaddingFactor: 2 },
  { windowSize: 4096, zeroPaddingFactor: 2 },
  { windowSize: 8192, zeroPaddingFactor: 2 },
];
const foreignIdleMs = 2000;
const foreignSettleMs = 300;
const renderProgressStart = 0.2;

const buildRenderConfig = (columns: number): SpectrogramConfig => ({
  ...defaultSpectrogramConfig,
  canvas: new OffscreenCanvas(columns, 8),
  viewSize: { width: columns, height: 8 },
  lanes: {
    lead: {
      ...defaultSpectrogramConfig.lanes.lead,
      showSpectrogram: false,
      showFundamental: true,
      showNotes: false,
    },
    recording: {
      ...defaultSpectrogramConfig.lanes.recording,
      showSpectrogram: false,
      showFundamental: false,
      showNotes: false,
    },
  },
});

const createRenderDriver = (
  samples: Float32Array,
  columns: number,
  scenario: SpectrogramBenchScenario,
): BenchDriver => {
  const progressStep = scenario.framesPerRender / samples.length;
  let progress = renderProgressStart;
  return {
    config: buildRenderConfig(columns),
    prime: async (processor) => {
      await processor.render({ lead: samples }, progress);
    },
    render: async (processor) => {
      if (scenario.kind === 'full') {
        await processor.render({ lead: samples.subarray(0) }, progress);
        return;
      }
      progress += progressStep;
      await processor.render({ lead: samples }, progress);
    },
  };
};

type ForeignWait = {
  submittedAt: number;
  ms: number;
};

type ForeignProbe = {
  between: (from: number, to: number) => number[];
  stop: () => void;
};

const startForeignProbe = async (): Promise<ForeignProbe> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./foreignJobProbe.ts', import.meta.url),
      { type: 'module' },
    );
    const waits: ForeignWait[] = [];
    const between = (from: number, to: number): number[] =>
      waits
        .filter((wait) => wait.submittedAt >= from && wait.submittedAt < to)
        .map((wait) => wait.ms);
    const stop = (): void => {
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<ForeignProbeReport>) => {
      if (event.data.kind === 'started') {
        resolve({ between, stop });
        return;
      }
      if (event.data.kind === 'wait') {
        waits.push({ submittedAt: event.data.submittedAt, ms: event.data.ms });
        return;
      }
      reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      reject(new Error(event.message));
    };
  });

const epochNow = (): number => performance.timeOrigin + performance.now();

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const summarizeWaits = (waits: number[]): PitchPerfProbe => {
  const sorted = [...waits].sort((a, b) => a - b);
  const at = (share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    worst: sorted.at(-1) ?? 0,
  };
};

const fetchSamples = async (url: string): Promise<Float32Array> => {
  const response = await fetch(url);
  return new Float32Array(await response.arrayBuffer());
};

const measureRender = async (
  samples: Float32Array,
  columns: number,
): Promise<PitchPerfRender> => {
  const foreign = await startForeignProbe();
  const idleFrom = epochNow();
  await sleep(foreignIdleMs);
  const idleTo = epochNow();
  const fullDriver = createRenderDriver(samples, columns, fullMount);
  await warmDriver(fullDriver);
  const fullFrom = epochNow();
  const full = await measureWallDriver(fullDriver);
  const fullTo = epochNow();
  await sleep(foreignSettleMs);
  const foreignAlone = summarizeWaits(foreign.between(idleFrom, idleTo));
  const foreignFull = summarizeWaits(foreign.between(fullFrom, fullTo));
  foreign.stop();
  const frame = await measureWallDriver(
    createRenderDriver(samples, columns, playback60Fps),
  );
  return {
    columns,
    full: { mean: full.mean, cv: full.cv },
    frame: { mean: frame.mean, cv: frame.cv },
    foreignAlone,
    foreignFull,
  };
};

it('measures the pitch kernels and a render of the window', async (context) => {
  const request = inject('pitchPerf');
  if (!request) {
    context.skip();
    return;
  }
  const { device } = await createGpuContext(true);
  const kernels: PitchPerfTable[] = [];
  for (const columns of kernelColumns) {
    kernels.push(await measureKernelTable(device, columns, kernelSpectra));
  }
  const samples = await fetchSamples(request.pcmUrl);
  const result: PitchPerfResult = {
    kernels,
    render: await measureRender(samples, request.columns),
  };
  Object.assign(context.task.meta, {
    pitchPerf: { result, markdown: formatPitchPerfMarkdown(result) },
  });
});
