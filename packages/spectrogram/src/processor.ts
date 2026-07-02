import { createCallLatest } from '@musetric/utils';
import {
  expandColumnRanges,
  markInvalidatedColumns,
  markShiftColumns,
  toColumnRanges,
} from './common/columnRanges.js';
import {
  computeBaseColumn,
  floorMod,
  fullColumnRange,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from './common/extConfig.js';
import {
  createSpectrogramProcessorTimer,
  type SpectrogramProcessorMetrics,
  type SpectrumStage,
  spectrumStages,
} from './common/processorTimer.js';
import {
  mergeSampleInvalidation,
  type SpectrogramSampleInvalidation,
} from './common/sampleInvalidations.js';
import {
  allTrackKeys,
  mapTrackKeys,
  type SpectrogramConfig,
  type TrackKey,
} from './config.cross.js';
import {
  createSpectrogramConfigurator,
  type SpectrogramRuntime,
} from './configurator.js';
import {
  type SpectrogramLane,
  type SpectrogramLaneWork,
} from './lane/index.js';

export type SpectrogramSamples = Partial<Record<TrackKey, Float32Array>>;

const emptyInvalidations: readonly SpectrogramSampleInvalidation[] = [];

export type SpectrogramProcessor = {
  render: (
    samples: SpectrogramSamples,
    trackProgress: number,
  ) => Promise<boolean>;

  invalidateSamples: (
    invalidations: readonly SpectrogramSampleInvalidation[],
  ) => void;
  updateConfig: (config: Partial<SpectrogramConfig>) => void;
  dispose: () => void;
};

export type CreateSpectrogramProcessorOptions = {
  device: GPUDevice;
  config?: Partial<SpectrogramConfig>;

  onMetrics?: (metrics: SpectrogramProcessorMetrics) => void;
};

const createTrackWork = (
  runtime: SpectrogramRuntime,
): Record<TrackKey, SpectrogramLaneWork> =>
  mapTrackKeys((key) => {
    const lane = runtime.config.lanes[key];
    return {
      spectrogram: lane.showSpectrogram,
      fundamental: lane.showFundamental,
    };
  });

const hasVisibleWork = (work: SpectrogramLaneWork): boolean =>
  work.spectrogram || work.fundamental;

type TrackResident = {
  valid: boolean;
  samples: Float32Array | undefined;
  sampleLength: number;
  baseColumn: number;
};

type TrackRenderPlan = {
  present: boolean;
  clearMissing: boolean;
  baseColumn: number;
  baseSlot: number;
  ranges: readonly SpectrogramColumnRange[];
  forceFullUpload: boolean;
  invalidations: readonly SpectrogramSampleRange[];
};

type RenderResult = {
  ok: boolean;
};

type ConfigInvalidationScope = 'all' | ReadonlySet<TrackKey>;

const createTrackResidents = (): Record<TrackKey, TrackResident> =>
  mapTrackKeys(() => ({
    valid: false,
    samples: undefined,
    sampleLength: 0,
    baseColumn: 0,
  }));

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

const emptyConfigInvalidationScope: ConfigInvalidationScope = new Set();

const isTrackConfigInvalidated = (
  scope: ConfigInvalidationScope,
  key: TrackKey,
): boolean => scope === 'all' || scope.has(key);

const isLaneComputeConfigEqual = (
  current: SpectrogramConfig['lanes'][TrackKey],
  next: SpectrogramConfig['lanes'][TrackKey],
): boolean =>
  current.showSpectrogram === next.showSpectrogram &&
  current.showFundamental === next.showFundamental &&
  current.truncateAfterPlayhead === next.truncateAfterPlayhead &&
  current.gainDb === next.gainDb;

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

const createConfigInvalidationScope = (
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

  const changedTracks = new Set<TrackKey>();
  for (const key of allTrackKeys) {
    if (!isLaneComputeConfigEqual(current.lanes[key], next.lanes[key])) {
      changedTracks.add(key);
    }
  }
  return changedTracks;
};

const fundamentalFilterRadius = 6;

const createRenderPlans = (options: {
  columns: boolean[];
  configInvalidationScope: ConfigInvalidationScope;
  invalidatedSamples: readonly SpectrogramSampleInvalidation[];
  residents: Record<TrackKey, TrackResident>;
  runtime: SpectrogramRuntime;
  samples: SpectrogramSamples;
  trackProgress: number;
  work: Record<TrackKey, SpectrogramLaneWork>;
}): Record<TrackKey, TrackRenderPlan> => {
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
        markInvalidatedColumns(
          columns,
          runtime.config,
          baseColumn,
          getMaxAnalysisWindowSize(runtime, trackWork),
          invalidations,
        );
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

type DispatchContext = {
  plans: Record<TrackKey, TrackRenderPlan>;
  runtime: SpectrogramRuntime;
  work: Record<TrackKey, SpectrogramLaneWork>;
};

const hasSpectrumWork = (ctx: DispatchContext, key: TrackKey): boolean =>
  ctx.plans[key].ranges.length > 0 && hasVisibleWork(ctx.work[key]);

const hasFundamentalWork = (ctx: DispatchContext, key: TrackKey): boolean =>
  ctx.plans[key].ranges.length > 0 &&
  ctx.runtime.config.lanes[key].showFundamental;

const hasRemapWork = (ctx: DispatchContext, key: TrackKey): boolean =>
  ctx.runtime.config.lanes[key].showSpectrogram &&
  (ctx.plans[key].ranges.length > 0 || ctx.plans[key].clearMissing);

const stageDispatchKeys = {
  sliceSamples: 'dispatchSliceSamples',
  fourierTransform: 'dispatchFourierTransform',
  magnitudify: 'dispatchMagnitudify',
  decibelify: 'dispatchDecibelify',
} as const satisfies Record<SpectrumStage, keyof SpectrogramLane>;

const dispatchSpectrumStage = (
  pass: GPUComputePassEncoder,
  ctx: DispatchContext,
  stage: SpectrumStage,
) => {
  for (const key of allTrackKeys) {
    if (!hasSpectrumWork(ctx, key)) {
      continue;
    }
    const { lane } = ctx.runtime.tracks[key];
    const trackWork = ctx.work[key];
    const dispatchStage = lane[stageDispatchKeys[stage]];
    for (const range of ctx.plans[key].ranges) {
      dispatchStage(pass, trackWork, range);
    }
  }
};

const dispatchFundamental = (
  pass: GPUComputePassEncoder,
  ctx: DispatchContext,
) => {
  const { plans, runtime } = ctx;
  for (const key of allTrackKeys) {
    if (!hasFundamentalWork(ctx, key)) {
      continue;
    }
    for (const range of plans[key].ranges) {
      runtime.tracks[key].lane.dispatchFundamentalScore(pass, range);
    }
  }
  for (const key of allTrackKeys) {
    if (!hasFundamentalWork(ctx, key)) {
      continue;
    }
    const ranges = expandColumnRanges(
      runtime.config,
      plans[key].baseColumn,
      plans[key].ranges,
      fundamentalFilterRadius,
    );
    for (const range of ranges) {
      runtime.tracks[key].lane.dispatchFundamentalFilter(pass, range);
    }
  }
};

const dispatchRemap = (pass: GPUComputePassEncoder, ctx: DispatchContext) => {
  const { plans, runtime } = ctx;
  for (const key of allTrackKeys) {
    if (!hasRemapWork(ctx, key)) {
      continue;
    }
    const plan = plans[key];
    const ranges = plan.clearMissing
      ? [fullColumnRange(runtime.config, 0)]
      : plan.ranges;
    for (const range of ranges) {
      runtime.tracks[key].remap?.dispatch(pass, range);
    }
  }
};

type ComputeMarkers = {
  spectrum: Readonly<
    Record<SpectrumStage, GPUComputePassTimestampWrites | undefined>
  >;
  fundamental: GPUComputePassTimestampWrites | undefined;
  remap: GPUComputePassTimestampWrites | undefined;
};

const runPass = (
  encoder: GPUCommandEncoder,
  label: string,
  timestampWrites: GPUComputePassTimestampWrites | undefined,
  body: (pass: GPUComputePassEncoder) => void,
) => {
  const pass = encoder.beginComputePass({ label, timestampWrites });
  body(pass);
  pass.end();
};

const dispatchCompute = (
  encoder: GPUCommandEncoder,
  options: {
    ctx: DispatchContext;
    markers: ComputeMarkers;
  },
) => {
  const { ctx, markers } = options;
  const spectrumHasWork = allTrackKeys.some((key) => hasSpectrumWork(ctx, key));
  const fundamentalHasWork = allTrackKeys.some((key) =>
    hasFundamentalWork(ctx, key),
  );
  const remapHasWork = allTrackKeys.some((key) => hasRemapWork(ctx, key));
  const profiling =
    spectrumStages.some((stage) => markers.spectrum[stage]) ||
    markers.fundamental !== undefined ||
    markers.remap !== undefined;

  if (profiling) {
    for (const stage of spectrumStages) {
      if (spectrumHasWork || markers.spectrum[stage]) {
        runPass(encoder, `${stage}-pass`, markers.spectrum[stage], (pass) =>
          dispatchSpectrumStage(pass, ctx, stage),
        );
      }
    }
    if (fundamentalHasWork || markers.fundamental !== undefined) {
      runPass(
        encoder,
        'fundamentalFrequency-pass',
        markers.fundamental,
        (pass) => dispatchFundamental(pass, ctx),
      );
    }
    if (remapHasWork || markers.remap !== undefined) {
      runPass(encoder, 'remap-pass', markers.remap, (pass) =>
        dispatchRemap(pass, ctx),
      );
    }
    return;
  }

  if (!spectrumHasWork && !fundamentalHasWork && !remapHasWork) {
    return;
  }
  runPass(encoder, 'pipeline-pass', undefined, (pass) => {
    for (const stage of spectrumStages) {
      dispatchSpectrumStage(pass, ctx, stage);
    }
    dispatchFundamental(pass, ctx);
    dispatchRemap(pass, ctx);
  });
};

export const createSpectrogramProcessor = (
  options: CreateSpectrogramProcessorOptions,
): SpectrogramProcessor => {
  const { device, config, onMetrics } = options;

  const timer = createSpectrogramProcessorTimer(device, onMetrics);
  const { markers } = timer;
  const computeMarkers: ComputeMarkers = {
    spectrum: {
      sliceSamples: markers.getGpuMarker('sliceSamples'),
      fourierTransform: markers.getGpuMarker('fourierTransform'),
      magnitudify: markers.getGpuMarker('magnitudify'),
      decibelify: markers.getGpuMarker('decibelify'),
    },
    fundamental: markers.getGpuMarker('fundamentalFrequency'),
    remap: markers.getGpuMarker('remap'),
  };

  const configurator = createSpectrogramConfigurator(device, markers);
  configurator.updateConfig(config);

  const writeBuffers = markers.writeBuffers(
    (
      runtime: SpectrogramRuntime,
      samples: SpectrogramSamples,
      plans: Record<TrackKey, TrackRenderPlan>,
      work: Record<TrackKey, SpectrogramLaneWork>,
    ) => {
      for (const key of allTrackKeys) {
        const trackSamples = samples[key];
        const trackWork = work[key];
        const plan = plans[key];
        if (
          trackSamples &&
          plan.ranges.length > 0 &&
          hasVisibleWork(trackWork)
        ) {
          runtime.tracks[key].lane.writeSamples(
            trackSamples,
            plan.baseColumn,
            trackWork,
            plan.forceFullUpload,
            plan.invalidations,
          );
        }
      }
    },
  );
  const createCommand = markers.createCommand(
    (
      runtime: SpectrogramRuntime,
      plans: Record<TrackKey, TrackRenderPlan>,
      work: Record<TrackKey, SpectrogramLaneWork>,
    ) => {
      const encoder = device.createCommandEncoder({
        label: 'processor-render-encoder',
      });
      for (const key of allTrackKeys) {
        if (plans[key].clearMissing) {
          runtime.tracks[key].lane.clear(encoder);
        }
      }
      dispatchCompute(encoder, {
        ctx: { plans, runtime, work },
        markers: computeMarkers,
      });
      const baseSlots = mapTrackKeys((key) => plans[key].baseSlot);
      runtime.draw.run(encoder, baseSlots);
      timer.resolve(encoder);
      return encoder.finish();
    },
  );

  const submitCommand = markers.submitCommand(
    async (command: GPUCommandBuffer) => {
      device.queue.submit([command]);
      await device.queue.onSubmittedWorkDone();
    },
  );

  const residents = createTrackResidents();
  let reusableColumns: boolean[] = [];
  let lastConfig: SpectrogramRuntime['config'] | undefined = undefined;
  let lastBaseSlots: Record<TrackKey, number> | undefined = undefined;

  const isRenderNoop = (plans: Record<TrackKey, TrackRenderPlan>): boolean => {
    const previousBaseSlots = lastBaseSlots;
    if (!previousBaseSlots) {
      return false;
    }
    return allTrackKeys.every((key) => {
      const plan = plans[key];
      return (
        plan.ranges.length === 0 &&
        !plan.clearMissing &&
        plan.baseSlot === previousBaseSlots[key]
      );
    });
  };
  let pendingInvalidations: SpectrogramSampleInvalidation[] = [];

  const consumeInvalidations = (
    samples: SpectrogramSamples,
  ): readonly SpectrogramSampleInvalidation[] => {
    if (pendingInvalidations.length < 1) {
      return emptyInvalidations;
    }
    const consumed = pendingInvalidations;
    pendingInvalidations = [];
    return consumed.filter(
      (invalidation) =>
        invalidation.frameCount > 0 &&
        samples[invalidation.trackKey] !== undefined,
    );
  };

  const commitPlans = (
    runtime: SpectrogramRuntime,
    samples: SpectrogramSamples,
    plans: Record<TrackKey, TrackRenderPlan>,
    work: Record<TrackKey, SpectrogramLaneWork>,
  ) => {
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
    lastConfig = runtime.config;
  };

  const runRender = markers.total(
    async (
      samples: SpectrogramSamples,
      trackProgress: number,
    ): Promise<RenderResult> => {
      const runtime = configurator.configure();
      if (!runtime) {
        return { ok: false };
      }
      timer.configure();
      const configChanged = runtime.config !== lastConfig;
      const configInvalidationScope = configChanged
        ? createConfigInvalidationScope(lastConfig, runtime.config)
        : emptyConfigInvalidationScope;
      const work = createTrackWork(runtime);
      if (reusableColumns.length !== runtime.config.windowCount) {
        reusableColumns = new Array(runtime.config.windowCount).fill(false);
      }
      const invalidatedSamples = consumeInvalidations(samples);
      const plans = createRenderPlans({
        columns: reusableColumns,
        configInvalidationScope,
        invalidatedSamples,
        residents,
        runtime,
        samples,
        trackProgress,
        work,
      });
      if (!onMetrics && !configChanged && isRenderNoop(plans)) {
        return { ok: true };
      }
      writeBuffers(runtime, samples, plans, work);
      const command = createCommand(runtime, plans, work);
      await submitCommand(command);
      commitPlans(runtime, samples, plans, work);
      lastBaseSlots = mapTrackKeys((key) => plans[key].baseSlot);
      return { ok: true };
    },
  );

  const renderLatest = createCallLatest(
    async (samples: SpectrogramSamples, trackProgress: number) => {
      const result = await runRender(samples, trackProgress);
      if (!result.ok) {
        return false;
      }
      await timer.finish();
      return true;
    },
  );

  return {
    render: renderLatest,
    invalidateSamples: (invalidations) => {
      for (const invalidation of invalidations) {
        pendingInvalidations = mergeSampleInvalidation(
          pendingInvalidations,
          invalidation,
        );
      }
    },
    updateConfig: configurator.updateConfig,
    dispose: () => {
      timer.dispose();
      configurator.dispose();
    },
  };
};
