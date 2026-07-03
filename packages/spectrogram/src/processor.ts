import { createCallLatest } from '@musetric/utils';
import {
  createSpectrogramProcessorTimer,
  type SpectrogramMarkers,
  type SpectrogramProcessorMetrics,
  type SpectrogramProcessorTimer,
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
import { type SpectrogramLaneWork } from './lane/index.js';
import {
  type ComputeMarkers,
  dispatchCompute,
} from './processor/computeDispatch.js';
import {
  commitResidentPlans,
  createConfigInvalidationScope,
  createRenderPlans,
  createTrackResidents,
  createTrackWork,
  drainPendingInvalidations,
  isRenderNoop,
  type RenderResult,
  type TrackRenderPlan,
  writeTrackSamples,
} from './processor/renderPlan.js';

const createComputeMarkers = (
  getGpuMarker: SpectrogramMarkers['getGpuMarker'],
): ComputeMarkers => ({
  spectrum: {
    sliceSamples: getGpuMarker('sliceSamples'),
    fourierTransform: getGpuMarker('fourierTransform'),
    magnitudify: getGpuMarker('magnitudify'),
    decibelify: getGpuMarker('decibelify'),
  },
  fundamental: getGpuMarker('fundamentalFrequency'),
  remap: getGpuMarker('remap'),
});

const encodeRenderCommand =
  (
    device: GPUDevice,
    timer: SpectrogramProcessorTimer,
    computeMarkers: ComputeMarkers,
  ) =>
  (
    runtime: SpectrogramRuntime,
    plans: Record<TrackKey, TrackRenderPlan>,
    work: Record<TrackKey, SpectrogramLaneWork>,
  ): GPUCommandBuffer => {
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
    runtime.draw.run(
      encoder,
      mapTrackKeys((key) => plans[key].baseSlot),
    );
    timer.resolve(encoder);
    return encoder.finish();
  };

const noConfigInvalidations: ReadonlySet<TrackKey> = new Set();

export type SpectrogramSamples = Partial<Record<TrackKey, Float32Array>>;

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

export const createSpectrogramProcessor = (
  options: CreateSpectrogramProcessorOptions,
): SpectrogramProcessor => {
  const { device, config, onMetrics } = options;

  const timer = createSpectrogramProcessorTimer(device, onMetrics);
  const computeMarkers = createComputeMarkers(timer.markers.getGpuMarker);

  const configurator = createSpectrogramConfigurator(device, timer.markers);
  configurator.updateConfig(config);

  const writeBuffers = timer.markers.writeBuffers(writeTrackSamples);
  const createCommand = timer.markers.createCommand(
    encodeRenderCommand(device, timer, computeMarkers),
  );

  const submitCommand = timer.markers.submitCommand(
    async (command: GPUCommandBuffer) => {
      device.queue.submit([command]);
      await device.queue.onSubmittedWorkDone();
    },
  );

  const residents = createTrackResidents();
  let reusableColumns: boolean[] = [];
  let lastConfig: SpectrogramRuntime['config'] | undefined = undefined;
  let lastBaseSlots: Record<TrackKey, number> | undefined = undefined;
  let pendingInvalidations: SpectrogramSampleInvalidation[] = [];

  const ensureColumns = (windowCount: number): boolean[] => {
    if (reusableColumns.length !== windowCount) {
      reusableColumns = new Array(windowCount).fill(false);
    }
    return reusableColumns;
  };

  const runRender = timer.markers.total(
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
        : noConfigInvalidations;
      const work = createTrackWork(runtime);
      const columns = ensureColumns(runtime.config.windowCount);
      const invalidatedSamples = drainPendingInvalidations(
        pendingInvalidations,
        samples,
      );
      pendingInvalidations = [];
      const plans = createRenderPlans({
        columns,
        configInvalidationScope,
        invalidatedSamples,
        residents,
        runtime,
        samples,
        trackProgress,
        work,
      });
      if (!onMetrics && !configChanged && isRenderNoop(plans, lastBaseSlots)) {
        return { ok: true };
      }
      writeBuffers(runtime, samples, plans, work);
      const command = createCommand(runtime, plans, work);
      await submitCommand(command);
      commitResidentPlans(residents, samples, plans, work);
      lastConfig = runtime.config;
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
