import { createGpuContext } from '@musetric/utils/gpu';
import { commands } from '@vitest/browser/context';
import { inject, it } from 'vitest';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { fundamentalTrackWindow } from '../fundamentalFrequency/params.js';
import {
  createSpectrogramProcessor,
  type SpectrogramProcessor,
} from '../processor.js';
import {
  comparePitch,
  formatPitchCsv,
  parsePitchCsv,
  type PitchCompareRequest,
  type PitchExtractRequest,
  type PitchExtractResult,
} from './pitchAccuracy.es.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    pitchExtract?: PitchExtractRequest;
    pitchCompare?: PitchCompareRequest;
  }
}

const { sampleRate } = defaultSpectrogramConfig;

const hopSamplesOf = (request: PitchExtractRequest): number =>
  (sampleRate * request.hopMs) / 1000;

const stepColumnsOf = (request: PitchExtractRequest): number =>
  request.columns - 2 * fundamentalTrackWindow;

type ColumnRange = {
  first: number;
  last: number;
};

const columnRangeOf = (
  samples: Float32Array,
  request: PitchExtractRequest,
): ColumnRange => {
  const hopSamples = hopSamplesOf(request);
  const toColumn = (seconds: number): number =>
    ((seconds - request.pcmStartSeconds) * sampleRate) / hopSamples;
  return {
    first: Math.max(0, Math.floor(toColumn(request.fromSeconds))),
    last: Math.min(
      Math.floor(samples.length / hopSamples),
      Math.ceil(toColumn(request.toSeconds)),
    ),
  };
};

const buildConfig = (request: PitchExtractRequest): SpectrogramConfig => ({
  ...defaultSpectrogramConfig,
  canvas: new OffscreenCanvas(request.columns, 8),
  viewSize: { width: request.columns, height: 8 },
  visibleTime: (hopSamplesOf(request) * (request.columns - 1)) / sampleRate,
  playheadRatio: 0,
  windowSize: request.windowSize,
  zeroPaddingFactor: request.zeroPaddingFactor,
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

type ChunkRun = {
  processor: SpectrogramProcessor;
  samples: Float32Array;
  request: PitchExtractRequest;
  range: ColumnRange;
};

const renderChunks = async (
  run: ChunkRun,
  onRendered: () => Promise<void>,
): Promise<void> => {
  const { processor, samples, request, range } = run;
  const hopSamples = hopSamplesOf(request);
  for (
    let baseColumn = range.first - fundamentalTrackWindow;
    baseColumn + fundamentalTrackWindow < range.last;
    baseColumn += stepColumnsOf(request)
  ) {
    const progress =
      (baseColumn * hopSamples + request.windowSize / 2) / samples.length;
    await processor.render({ lead: samples }, progress);
    await onRendered();
  }
};

const extractFundamental = async (
  device: GPUDevice,
  samples: Float32Array,
  request: PitchExtractRequest,
): Promise<PitchExtractResult> => {
  const hopSamples = hopSamplesOf(request);
  const range = columnRangeOf(samples, request);
  const values = new Float32Array(Math.max(0, range.last - range.first));
  const processor = createSpectrogramProcessor({
    device,
    config: buildConfig(request),
  });
  try {
    await renderChunks({ processor, samples, request, range }, async () => {
      const line = await processor.readFundamentalLine('lead');
      if (!line) {
        throw new Error('the fundamental line was not rendered');
      }
      for (
        let index = fundamentalTrackWindow;
        index < request.columns - fundamentalTrackWindow;
        index += 1
      ) {
        const column = line.baseColumn + index;
        if (column >= range.first && column < range.last) {
          values[column - range.first] = line.values[index];
        }
      }
    });
  } finally {
    processor.dispose();
  }
  return {
    hopSeconds: hopSamples / sampleRate,
    startSeconds:
      request.pcmStartSeconds + (range.first * hopSamples) / sampleRate,
    values: Array.from(values),
  };
};

const fetchSamples = async (url: string): Promise<Float32Array> => {
  const response = await fetch(url);
  return new Float32Array(await response.arrayBuffer());
};

it('extracts the fundamental line of a track', async (context) => {
  const request = inject('pitchExtract');
  if (!request) {
    context.skip();
    return;
  }
  const { device } = await createGpuContext();
  const samples = await fetchSamples(request.pcmUrl);
  const result = await extractFundamental(device, samples, request);
  Object.assign(context.task.meta, {
    pitchExtract: { csv: formatPitchCsv(result), frames: result.values.length },
  });
});

it('compares a pitch track with its reference', async (context) => {
  const request = inject('pitchCompare');
  if (!request) {
    context.skip();
    return;
  }
  const reference = parsePitchCsv(
    await commands.readFile(request.referencePath, 'utf8'),
  );
  const ours = parsePitchCsv(await commands.readFile(request.oursPath, 'utf8'));
  Object.assign(context.task.meta, {
    pitchCompare: comparePitch(
      reference,
      ours,
      request.fromSeconds,
      request.toSeconds ?? Infinity,
    ),
  });
});
