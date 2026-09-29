import { createGpuContext } from '@musetric/utils/gpu';
import { commands } from '@vitest/browser/context';
import { inject, it } from 'vitest';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { createPitchSettings } from '../fundamentalFrequency/settings.es.js';
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
import { comparePitchLine } from './pitchLine.es.js';
import { formatPitchReport, type PitchTrackReport } from './pitchReport.es.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    pitchExtract?: PitchExtractRequest;
    pitchCompare?: PitchCompareRequest[];
  }
}

const { sampleRate } = defaultSpectrogramConfig;

const { hop } = createPitchSettings(sampleRate);

type ColumnRange = {
  first: number;
  last: number;
};

const columnRangeOf = (
  samples: Float32Array,
  request: PitchExtractRequest,
): ColumnRange => {
  const toColumn = (seconds: number): number =>
    ((seconds - request.pcmStartSeconds) * sampleRate) / hop;
  return {
    first: Math.max(0, Math.floor(toColumn(request.fromSeconds))),
    last: Math.min(
      Math.floor(samples.length / hop),
      Math.ceil(toColumn(request.toSeconds)),
    ),
  };
};

const buildConfig = (request: PitchExtractRequest): SpectrogramConfig => ({
  ...defaultSpectrogramConfig,
  canvas: new OffscreenCanvas(request.columns, 8),
  viewSize: { width: request.columns, height: 8 },
  visibleTime: (hop * (request.columns - 1)) / sampleRate,
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

const renderUntilComplete = async (
  processor: SpectrogramProcessor,
  samples: Float32Array,
  progress: number,
): Promise<void> => {
  await processor.render({ lead: samples }, progress);
  while (processor.hasPendingWork()) {
    await processor.render({ lead: samples }, progress);
  }
};

const extractFundamental = async (
  device: GPUDevice,
  samples: Float32Array,
  request: PitchExtractRequest,
): Promise<PitchExtractResult> => {
  const range = columnRangeOf(samples, request);
  const values = new Float32Array(Math.max(0, range.last - range.first));
  const confidence = new Float32Array(values.length);
  const processor = createSpectrogramProcessor({
    device,
    config: buildConfig(request),
  });
  try {
    for (
      let baseColumn = range.first;
      baseColumn < range.last;
      baseColumn += request.columns
    ) {
      const progress =
        (baseColumn * hop + request.windowSize / 2) / samples.length;
      await renderUntilComplete(processor, samples, progress);
      const frames = await processor.readFundamentalFrames(
        'lead',
        baseColumn,
        request.columns,
      );
      if (!frames) {
        throw new Error('the fundamental frames were not rendered');
      }
      const count = Math.min(request.columns, range.last - baseColumn);
      values.set(frames.values.subarray(0, count), baseColumn - range.first);
      confidence.set(
        frames.confidence.subarray(0, count),
        baseColumn - range.first,
      );
    }
  } finally {
    processor.dispose();
  }
  return {
    hopSeconds: hop / sampleRate,
    startSeconds: request.pcmStartSeconds + (range.first * hop) / sampleRate,
    values: Array.from(values),
    confidence: Array.from(confidence),
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

it('compares pitch tracks with their references', async (context) => {
  const requests = inject('pitchCompare');
  if (!requests) {
    context.skip();
    return;
  }
  const reports: PitchTrackReport[] = [];
  for (const request of requests) {
    const reference = parsePitchCsv(
      await commands.readFile(request.referencePath, 'utf8'),
    );
    const ours = parsePitchCsv(
      await commands.readFile(request.oursPath, 'utf8'),
    );
    const toSeconds = request.toSeconds ?? Infinity;
    const line = comparePitchLine(reference, ours, {
      fromSeconds: request.fromSeconds,
      toSeconds,
      worstCount: request.worstCount,
    });
    reports.push({
      name: request.name,
      accuracy: comparePitch(reference, ours, request.fromSeconds, toSeconds),
      line: line.overview,
      worst: line.worst,
    });
  }
  const worstCount = requests[0]?.worstCount ?? 0;
  Object.assign(context.task.meta, {
    pitchCompare: { reports, markdown: formatPitchReport(reports, worstCount) },
  });
});
