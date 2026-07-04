import {
  markInvalidatedColumns,
  markShiftColumns,
  toColumnRanges,
} from '../common/columnRanges.js';
import {
  computeBaseColumn,
  floorMod,
  fullColumnRange,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import { type SpectrogramSampleInvalidation } from '../common/sampleInvalidations.js';
import {
  allTrackKeys,
  hasSpectrogramComparison,
  mapTrackKeys,
  type SpectrogramConfig,
  type TrackKey,
} from '../config.cross.js';
import { type SpectrogramRuntime } from '../configurator.js';
import { type SpectrogramLaneWork } from '../lane/index.js';
import { type SpectrogramSamples } from '../processor.js';

const emptyInvalidations: readonly SpectrogramSampleInvalidation[] = [];

export type RenderResult = { ok: boolean };

const computeInvalidatingConfigKeys: readonly (keyof SpectrogramConfig)[] = [
  'fourierMode',
  'windowSize',
  'sampleRate',
  'visibleTime',
  'playheadRatio',
  'zeroPaddingFactor',
  'spectralBands',
  'windowName',
  'minDecibel',
  'visual',
  'minFrequency',
  'maxFrequency',
  'viewSize',
];

const isLaneComputeConfigEqual = (
  current: SpectrogramConfig['lanes'][TrackKey],
  next: SpectrogramConfig['lanes'][TrackKey],
): boolean =>
  current.showSpectrogram === next.showSpectrogram &&
  current.showFundamental === next.showFundamental &&
  current.showNotes === next.showNotes &&
  current.truncateAfterPlayhead === next.truncateAfterPlayhead &&
  current.gainDb === next.gainDb;

const isColorComputeConfigEqual = (
  current: SpectrogramConfig['comparison'],
  next: SpectrogramConfig['comparison'],
): boolean =>
  current.reference === next.reference &&
  current.target === next.target &&
  current.colorWindowLeftSeconds === next.colorWindowLeftSeconds &&
  current.colorWindowRightSeconds === next.colorWindowRightSeconds &&
  current.colorFalloffSigmaSeconds === next.colorFalloffSigmaSeconds;

export const hasVisibleWork = (work: SpectrogramLaneWork): boolean =>
  work.spectrogram || work.fundamental;

export type TrackResident = {
  valid: boolean;
  samples: Float32Array | undefined;
  sampleLength: number;
  baseColumn: number;
};

export const createTrackResidents = (): Record<TrackKey, TrackResident> =>
  mapTrackKeys(() => ({
    valid: false,
    samples: undefined,
    sampleLength: 0,
    baseColumn: 0,
  }));

export const createTrackWork = (
  runtime: SpectrogramRuntime,
): Record<TrackKey, SpectrogramLaneWork> =>
  mapTrackKeys((key) => {
    const lane = runtime.config.lanes[key];
    return {
      spectrogram: lane.showSpectrogram,
      fundamental:
        lane.showFundamental ||
        lane.showNotes ||
        hasSpectrogramComparison(runtime.config),
    };
  });

const getTrackInvalidations = (
  invalidatedSamples: readonly SpectrogramSampleInvalidation[],
  trackKey: TrackKey,
): SpectrogramSampleRange[] =>
  invalidatedSamples
    .filter((invalidation) => invalidation.trackKey === trackKey)
    .map((invalidation) => ({
      frameIndex: invalidation.frameIndex,
      frameCount: invalidation.frameCount,
    }));

type ConfigInvalidationScope = 'all' | ReadonlySet<TrackKey>;

const isTrackConfigInvalidated = (
  scope: ConfigInvalidationScope,
  key: TrackKey,
): boolean => scope === 'all' || scope.has(key);

const getMaxAnalysisWindowSize = (
  runtime: SpectrogramRuntime,
  work: SpectrogramLaneWork,
): number => {
  const spectrogramWindowSize = work.spectrogram
    ? Math.max(
        runtime.config.windowSize,
        ...runtime.config.spectralBands.map((band) => band.windowSize),
      )
    : 0;
  const fundamentalWindowSize = work.fundamental
    ? runtime.config.windowSize
    : 0;
  return Math.max(spectrogramWindowSize, fundamentalWindowSize);
};

export const createConfigInvalidationScope = (
  current: SpectrogramRuntime['config'] | undefined,
  next: SpectrogramRuntime['config'],
): ConfigInvalidationScope => {
  if (!current) {
    return 'all';
  }

  for (const key of computeInvalidatingConfigKeys) {
    if (current[key] !== next[key]) {
      return 'all';
    }
  }
  if (!isColorComputeConfigEqual(current.comparison, next.comparison)) {
    return 'all';
  }

  const changedTracks = new Set<TrackKey>();
  for (const key of allTrackKeys) {
    if (!isLaneComputeConfigEqual(current.lanes[key], next.lanes[key])) {
      changedTracks.add(key);
    }
  }
  return changedTracks;
};

type CreateRenderPlansOptions = {
  columns: boolean[];
  configInvalidationScope: ConfigInvalidationScope;
  invalidatedSamples: readonly SpectrogramSampleInvalidation[];
  residents: Record<TrackKey, TrackResident>;
  runtime: SpectrogramRuntime;
  samples: SpectrogramSamples;
  trackProgress: number;
  work: Record<TrackKey, SpectrogramLaneWork>;
};

export type TrackRenderPlan = {
  present: boolean;
  clearMissing: boolean;
  baseColumn: number;
  baseSlot: number;
  ranges: readonly SpectrogramColumnRange[];
  forceFullUpload: boolean;
  invalidations: readonly SpectrogramSampleRange[];
};

export const createRenderPlans = (
  options: CreateRenderPlansOptions,
): Record<TrackKey, TrackRenderPlan> => {
  const {
    columns,
    configInvalidationScope,
    invalidatedSamples,
    residents,
    runtime,
    samples,
    trackProgress,
    work,
  } = options;
  return mapTrackKeys<TrackRenderPlan>((key) => {
    const trackSamples = samples[key];
    const resident = residents[key];
    const present = trackSamples !== undefined;
    const baseColumn = present
      ? computeBaseColumn(runtime.config, trackProgress, trackSamples.length)
      : resident.baseColumn;
    const baseSlot = floorMod(baseColumn, runtime.config.windowCount);
    const invalidations = getTrackInvalidations(invalidatedSamples, key);
    const trackWork = work[key];
    const forceFullUpload =
      isTrackConfigInvalidated(configInvalidationScope, key) ||
      !resident.valid ||
      resident.samples !== trackSamples ||
      resident.sampleLength !== (trackSamples?.length ?? 0);

    let ranges: readonly SpectrogramColumnRange[] = [];
    if (present && hasVisibleWork(trackWork)) {
      if (forceFullUpload) {
        ranges = [fullColumnRange(runtime.config, baseColumn)];
      } else {
        columns.fill(false);
        markShiftColumns(columns, baseColumn, resident.baseColumn);
        markInvalidatedColumns({
          columns,
          grid: runtime.config,
          baseColumn,
          analysisWindowSize: getMaxAnalysisWindowSize(runtime, trackWork),
          invalidations,
        });
        ranges = toColumnRanges(runtime.config, baseColumn, columns);
      }
    }

    return {
      present,
      clearMissing: !present && resident.valid,
      baseColumn,
      baseSlot,
      ranges,
      forceFullUpload,
      invalidations,
    };
  });
};

export const writeTrackSamples = (
  runtime: SpectrogramRuntime,
  samples: SpectrogramSamples,
  plans: Record<TrackKey, TrackRenderPlan>,
  work: Record<TrackKey, SpectrogramLaneWork>,
): void => {
  for (const key of allTrackKeys) {
    const trackSamples = samples[key];
    const trackWork = work[key];
    const plan = plans[key];
    if (trackSamples && plan.ranges.length > 0 && hasVisibleWork(trackWork)) {
      runtime.tracks[key].lane.writeSamples({
        samples: trackSamples,
        baseColumn: plan.baseColumn,
        work: trackWork,
        forceFullUpload: plan.forceFullUpload,
        invalidations: plan.invalidations,
      });
    }
  }
};

export const drainPendingInvalidations = (
  pending: readonly SpectrogramSampleInvalidation[],
  samples: SpectrogramSamples,
): readonly SpectrogramSampleInvalidation[] =>
  pending.length < 1
    ? emptyInvalidations
    : pending.filter(
        (invalidation) =>
          invalidation.frameCount > 0 &&
          samples[invalidation.trackKey] !== undefined,
      );

export const commitResidentPlans = (
  residents: Record<TrackKey, TrackResident>,
  samples: SpectrogramSamples,
  plans: Record<TrackKey, TrackRenderPlan>,
  work: Record<TrackKey, SpectrogramLaneWork>,
): void => {
  for (const key of allTrackKeys) {
    const plan = plans[key];
    if (plan.clearMissing) {
      residents[key] = {
        valid: false,
        samples: undefined,
        sampleLength: 0,
        baseColumn: 0,
      };
      continue;
    }
    if (plan.present) {
      residents[key] = {
        valid: hasVisibleWork(work[key]),
        samples: samples[key],
        sampleLength: samples[key]?.length ?? 0,
        baseColumn: plan.baseColumn,
      };
    }
  }
};

export const isRenderNoop = (
  plans: Record<TrackKey, TrackRenderPlan>,
  lastBaseSlots: Record<TrackKey, number> | undefined,
): boolean => {
  if (!lastBaseSlots) {
    return false;
  }
  return allTrackKeys.every((key) => {
    const plan = plans[key];
    return (
      plan.ranges.length === 0 &&
      !plan.clearMissing &&
      plan.baseSlot === lastBaseSlots[key]
    );
  });
};
