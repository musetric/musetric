import { expandColumnRanges } from '../common/columnRanges.js';
import { fullColumnRange } from '../common/extConfig.js';
import {
  type SpectrumStage,
  spectrumStages,
} from '../common/processorTimer.js';
import { allTrackKeys, type TrackKey } from '../config.cross.js';
import { type SpectrogramRuntime } from '../configurator.js';
import { type SpectrogramLane } from '../lane/index.js';
import { type TrackRenderPlan } from './renderPlan.js';

const fundamentalFilterRadius = 6;

export type DispatchContext = {
  plans: Record<TrackKey, TrackRenderPlan>;
  runtime: SpectrogramRuntime;
  work: Record<TrackKey, { spectrogram: boolean; fundamental: boolean }>;
};

export type ComputeMarkers = {
  spectrum: Readonly<
    Record<SpectrumStage, GPUComputePassTimestampWrites | undefined>
  >;
  fundamental: GPUComputePassTimestampWrites | undefined;
  remap: GPUComputePassTimestampWrites | undefined;
};

const hasSpectrumWork = (ctx: DispatchContext, key: TrackKey): boolean =>
  ctx.plans[key].ranges.length > 0 &&
  (ctx.work[key].spectrogram || ctx.work[key].fundamental);

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
): void => {
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
): void => {
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
    const expanded = expandColumnRanges(
      runtime.config,
      plans[key].baseColumn,
      plans[key].ranges,
      fundamentalFilterRadius,
    );
    for (const range of expanded) {
      runtime.tracks[key].lane.dispatchFundamentalFilter(pass, range);
    }
  }
};

const dispatchRemap = (
  pass: GPUComputePassEncoder,
  ctx: DispatchContext,
): void => {
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

const runPass = (
  encoder: GPUCommandEncoder,
  label: string,
  timestampWrites: GPUComputePassTimestampWrites | undefined,
  body: (pass: GPUComputePassEncoder) => void,
): void => {
  const pass = encoder.beginComputePass({ label, timestampWrites });
  body(pass);
  pass.end();
};

export type DispatchComputeOptions = {
  ctx: DispatchContext;
  markers: ComputeMarkers;
};

export const dispatchCompute = (
  encoder: GPUCommandEncoder,
  options: DispatchComputeOptions,
): void => {
  const { ctx, markers } = options;
  const spectrumHasWork = allTrackKeys.some((key) => hasSpectrumWork(ctx, key));
  const fundamentalHasWork = allTrackKeys.some((key) =>
    hasFundamentalWork(ctx, key),
  );
  const remapHasWork = allTrackKeys.some((key) => hasRemapWork(ctx, key));
  const profiling =
    spectrumStages.some((stage) => markers.spectrum[stage] !== undefined) ||
    markers.fundamental !== undefined ||
    markers.remap !== undefined;

  if (profiling) {
    for (const stage of spectrumStages) {
      if (spectrumHasWork || markers.spectrum[stage] !== undefined) {
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
