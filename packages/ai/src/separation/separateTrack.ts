import {
  createSeparationFold,
  type FoldOptions,
  restoreSeparationFold,
  type SeparationFold,
} from './separationFold.js';
import {
  planSeparation,
  type SeparationGeometry,
  separationStep,
  type SeparationUnit,
} from './separationPlan.js';
import {
  readSeparationState,
  type SeparationLayout,
  writeSeparationState,
} from './separationState.js';
import {
  peakScale,
  raisePeaks,
  type SeparatedStems,
  separateStems,
  silentPeaks,
  stemScales,
  type StemValues,
  stereoChannels,
} from './separationStems.js';

const masks = 2;
const outputs = stereoChannels * masks;
export type SeparationSource = {
  frames: number;
  peak: () => Promise<number>;
  read: (start: number, channels: Float32Array[]) => Promise<void>;
};

const readWindow = async (
  source: SeparationSource,
  unit: SeparationUnit,
  mixtureScale: number,
  window: Float32Array,
): Promise<void> => {
  const chunkSamples = window.length / stereoChannels;
  if (unit.length < chunkSamples) {
    window.fill(0);
  }
  const channels = Array.from({ length: stereoChannels }, (_, channel) =>
    window.subarray(
      channel * chunkSamples,
      channel * chunkSamples + unit.length,
    ),
  );
  await source.read(unit.start, channels);
  if (mixtureScale === 1) {
    return;
  }
  for (const samples of channels) {
    for (let frame = 0; frame < unit.length; frame += 1) {
      samples[frame] = samples[frame] * mixtureScale;
    }
  }
};

export type SeparationModel = {
  processChunk: (chunk: {
    input: Float32Array<ArrayBuffer>;
    output: Float32Array<ArrayBuffer>;
  }) => Promise<void>;
  release: () => Promise<void>;
};

export type SeparationCommit = {
  unit: number;
  unitCount: number;
  stems: SeparatedStems;
  state: Uint8Array<ArrayBuffer>;
};

export type SeparateTrackOptions = {
  geometry: SeparationGeometry;
  channels: number;
  masks: number;
  source: SeparationSource;
  resume?: Uint8Array;
  loadModel: () => Promise<SeparationModel>;
  report: (unit: number, unitCount: number) => void;
  commit: (commit: SeparationCommit) => Promise<void>;
};

type SeparationProgress = {
  fold: SeparationFold;
  mixtureScale: number;
  peaks: StemValues;
};

const restoreProgress = (
  options: SeparateTrackOptions,
  foldOptions: FoldOptions,
  layout: SeparationLayout,
): SeparationProgress | undefined => {
  const restored =
    options.resume && readSeparationState(layout, options.resume);
  const fold = restored && restoreSeparationFold(foldOptions, restored.tail);
  return restored && fold
    ? { fold, mixtureScale: restored.mixtureScale, peaks: restored.peaks }
    : undefined;
};

export const separateTrack = async (
  options: SeparateTrackOptions,
): Promise<StemValues> => {
  const { geometry, source } = options;
  if (options.channels !== stereoChannels || options.masks !== masks) {
    throw new Error('Separation needs a stereo model with two masks');
  }
  const units = planSeparation(geometry, source.frames);
  const foldOptions: FoldOptions = {
    units,
    chunkSamples: geometry.chunkSamples,
    outputs,
    frames: source.frames,
  };
  const layout: SeparationLayout = {
    frames: source.frames,
    chunkSamples: geometry.chunkSamples,
    step: separationStep(geometry),
    unitCount: units.length,
    outputs,
  };
  const restored = restoreProgress(options, foldOptions, layout);
  if ((restored?.fold.nextUnit() ?? 0) === units.length) {
    return stemScales(restored?.peaks ?? silentPeaks());
  }
  const model = await options.loadModel();
  try {
    const progress = restored ?? {
      fold: createSeparationFold(foldOptions),
      mixtureScale: peakScale(await source.peak()),
      peaks: silentPeaks(),
    };
    const { fold, mixtureScale } = progress;
    let { peaks } = progress;
    const { chunkSamples } = geometry;
    const window = new Float32Array(stereoChannels * chunkSamples);
    const output = new Float32Array(outputs * chunkSamples);
    let committing: Promise<void> | undefined = undefined;
    while (fold.nextUnit() < units.length) {
      const index = fold.nextUnit();
      const unit = units[index];
      options.report(index, units.length);
      await readWindow(source, unit, mixtureScale, window);
      await model.processChunk({ input: window, output });
      const region = fold.add(output);
      if (
        region.start < unit.start ||
        region.start + region.frames > unit.start + unit.length
      ) {
        throw new Error(
          `The settled frames of unit ${String(index)} leave its window`,
        );
      }
      const stems = separateStems({
        vocals: region.channels.slice(0, stereoChannels),
        backing: region.channels.slice(stereoChannels, outputs),
        mixture: [
          window.subarray(0, chunkSamples),
          window.subarray(chunkSamples, stereoChannels * chunkSamples),
        ],
        offset: region.start - unit.start,
      });
      peaks = raisePeaks(peaks, stems);
      const state = writeSeparationState(layout, {
        tail: fold.tail(),
        mixtureScale,
        peaks,
      });
      await committing;
      committing = options.commit({
        unit: index,
        unitCount: units.length,
        stems,
        state,
      });
      committing.catch(() => undefined);
    }
    await committing;
    return stemScales(peaks);
  } finally {
    await model.release();
  }
};
