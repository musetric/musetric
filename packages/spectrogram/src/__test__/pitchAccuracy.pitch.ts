import { createGpuContext } from '@musetric/utils/gpu';
import { commands } from '@vitest/browser/context';
import { inject, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { createPitchSettings } from '../fundamentalFrequency/settings.es.js';
import { trackPitch } from '../pitchTrack.js';
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

const extractFundamental = async (
  device: GPUDevice,
  samples: Float32Array,
  request: PitchExtractRequest,
): Promise<PitchExtractResult> => {
  const range = columnRangeOf(samples, request);
  const track = await trackPitch({
    device,
    samples,
    firstFrame: range.first,
    frameCount: Math.max(0, range.last - range.first),
    columns: request.columns,
    windowSize: request.windowSize,
    zeroPaddingFactor: request.zeroPaddingFactor,
  });
  return {
    hopSeconds: track.hopSeconds,
    startSeconds: request.pcmStartSeconds + (range.first * hop) / sampleRate,
    values: Array.from(track.values),
    confidence: Array.from(track.confidence),
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
