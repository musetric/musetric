import { createGpuContext } from '@musetric/utils/gpu';
import { commands } from '@vitest/browser/context';
import { inject, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { fundamentalTrackWindow } from '../fundamentalFrequency/params.js';
import {
  createSpectrogramProcessor,
  type SpectrogramFundamentalLine,
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
const chunkColumns = 4096;

type ColumnRange = {
  first: number;
  last: number;
};

const copyColumns = (
  line: SpectrogramFundamentalLine,
  range: ColumnRange,
  values: Float32Array,
): void => {
  for (
    let index = fundamentalTrackWindow;
    index < chunkColumns - fundamentalTrackWindow;
    index += 1
  ) {
    const column = line.baseColumn + index;
    if (column >= range.first && column < range.last) {
      values[column - range.first] = line.values[index];
    }
  }
};

const extractFundamental = async (
  device: GPUDevice,
  samples: Float32Array,
  request: PitchExtractRequest,
): Promise<PitchExtractResult> => {
  const hopSamples = (sampleRate * request.hopMs) / 1000;
  const toColumn = (seconds: number): number =>
    ((seconds - request.pcmStartSeconds) * sampleRate) / hopSamples;
  const range: ColumnRange = {
    first: Math.max(0, Math.floor(toColumn(request.fromSeconds))),
    last: Math.min(
      Math.floor(samples.length / hopSamples),
      Math.ceil(toColumn(request.toSeconds)),
    ),
  };
  const values = new Float32Array(Math.max(0, range.last - range.first));
  const processor = createSpectrogramProcessor({
    device,
    config: {
      ...defaultSpectrogramConfig,
      canvas: new OffscreenCanvas(chunkColumns, 8),
      viewSize: { width: chunkColumns, height: 8 },
      visibleTime: (hopSamples * (chunkColumns - 1)) / sampleRate,
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
    },
  });
  try {
    for (
      let baseColumn = range.first - fundamentalTrackWindow;
      baseColumn + fundamentalTrackWindow < range.last;
      baseColumn += chunkColumns - 2 * fundamentalTrackWindow
    ) {
      const progress =
        (baseColumn * hopSamples + request.windowSize / 2) / samples.length;
      await processor.render({ lead: samples }, progress);
      const line = await processor.readFundamentalLine('lead');
      if (!line) {
        throw new Error('the fundamental line was not rendered');
      }
      copyColumns(line, range, values);
    }
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

it('extracts the fundamental line of a track', async (context) => {
  const request = inject('pitchExtract');
  if (!request) {
    context.skip();
    return;
  }
  const { device } = await createGpuContext();
  const response = await fetch(request.pcmUrl);
  const samples = new Float32Array(await response.arrayBuffer());
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
