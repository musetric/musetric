import { createCallLatest } from '@musetric/utils';
import {
  createSpectrogramProcessorTimer,
  type SpectrogramProcessorMetrics,
  type SpectrumStage,
  spectrumStages,
} from './common/processorTimer.js';
import {
  allTrackKeys,
  type SpectrogramConfig,
  type TrackKey,
} from './config.cross.js';
import {
  createSpectrogramConfigurator,
  type SpectrogramRuntime,
} from './configurator.js';
import { type SpectrogramLaneWork } from './lane/index.js';

export type SpectrogramSamples = Partial<Record<TrackKey, Float32Array>>;

export type SpectrogramSampleInvalidation = {
  trackKey: TrackKey;
  frameIndex: number;
  frameCount: number;
};

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

const createTrackFlags = (): Record<TrackKey, boolean> =>
  allTrackKeys.reduce(
    (acc, key) => {
      acc[key] = false;
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<TrackKey, boolean>,
  );

const createTrackWork = (
  runtime: SpectrogramRuntime,
): Record<TrackKey, SpectrogramLaneWork> =>
  allTrackKeys.reduce(
    (acc, key) => {
      const lane = runtime.config.lanes[key];
      acc[key] = {
        spectrogram: lane.showSpectrogram,
        fundamental: lane.showFundamental,
      };
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<TrackKey, SpectrogramLaneWork>,
  );

const dispatchSpectrumStage = (
  encoder: GPUCommandEncoder,
  options: {
    dirty: Record<TrackKey, boolean>;
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
    stage: SpectrumStage;
    work: Record<TrackKey, SpectrogramLaneWork>;
  },
) => {
  const { dirty, marker, presence, runtime, stage, work } = options;
  const hasWork = allTrackKeys.some((key) => {
    if (!presence[key] || !dirty[key]) {
      return false;
    }
    const trackWork = work[key];
    return trackWork.spectrogram || trackWork.fundamental;
  });
  if (!hasWork && !marker) {
    return;
  }
  const pass = encoder.beginComputePass({
    label: `${stage}-pass`,
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (!presence[key] || !dirty[key]) {
      continue;
    }
    const trackWork = work[key];
    if (!trackWork.spectrogram && !trackWork.fundamental) {
      continue;
    }
    const { lane } = runtime.tracks[key];
    if (stage === 'sliceSamples') {
      lane.dispatchSliceSamples(pass, trackWork);
    }
    if (stage === 'fourierTransform') {
      lane.dispatchFourierTransform(pass, trackWork);
    }
    if (stage === 'magnitudify') {
      lane.dispatchMagnitudify(pass, trackWork);
    }
    if (stage === 'decibelify') {
      lane.dispatchDecibelify(pass, trackWork);
    }
  }
  pass.end();
};

const dispatchFundamentalFrequency = (
  encoder: GPUCommandEncoder,
  options: {
    dirty: Record<TrackKey, boolean>;
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
  },
) => {
  const { dirty, marker, presence, runtime } = options;
  const hasWork = allTrackKeys.some(
    (key) =>
      presence[key] && dirty[key] && runtime.config.lanes[key].showFundamental,
  );
  if (!hasWork && !marker) {
    return;
  }
  const pass = encoder.beginComputePass({
    label: 'fundamentalFrequency-pass',
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (
      presence[key] &&
      dirty[key] &&
      runtime.config.lanes[key].showFundamental
    ) {
      runtime.tracks[key].lane.dispatchFundamentalFrequency(pass);
    }
  }
  pass.end();
};

const dispatchRemap = (
  encoder: GPUCommandEncoder,
  options: {
    clearMissing: Record<TrackKey, boolean>;
    dirty: Record<TrackKey, boolean>;
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
  },
) => {
  const { clearMissing, dirty, marker, presence, runtime } = options;
  const hasWork = allTrackKeys.some(
    (key) =>
      runtime.config.lanes[key].showSpectrogram &&
      ((presence[key] && dirty[key]) || clearMissing[key]),
  );
  if (!hasWork && !marker) {
    return;
  }
  const pass = encoder.beginComputePass({
    label: 'remap-pass',
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (!runtime.config.lanes[key].showSpectrogram) {
      continue;
    }
    if (!((presence[key] && dirty[key]) || clearMissing[key])) {
      continue;
    }
    runtime.tracks[key].remap?.dispatch(pass);
  }
  pass.end();
};

export const createSpectrogramProcessor = (
  options: CreateSpectrogramProcessorOptions,
): SpectrogramProcessor => {
  const { device, config, onMetrics } = options;

  const timer = createSpectrogramProcessorTimer(device, onMetrics);
  const { markers } = timer;

  const configurator = createSpectrogramConfigurator(device, markers);
  configurator.updateConfig(config);

  const writeBuffers = markers.writeBuffers(
    (
      runtime: SpectrogramRuntime,
      samples: SpectrogramSamples,
      trackProgress: number,
      dirty: Record<TrackKey, boolean>,
      contentChanged: Record<TrackKey, boolean>,
      work: Record<TrackKey, SpectrogramLaneWork>,
    ) => {
      for (const key of allTrackKeys) {
        const trackSamples = samples[key];
        const trackWork = work[key];
        if (
          trackSamples &&
          dirty[key] &&
          (trackWork.spectrogram || trackWork.fundamental)
        ) {
          runtime.tracks[key].lane.writeSamples(
            trackSamples,
            trackProgress,
            trackWork,
            contentChanged[key],
          );
        }
      }
    },
  );
  const createCommand = markers.createCommand(
    (
      runtime: SpectrogramRuntime,
      dirty: Record<TrackKey, boolean>,
      presence: Record<TrackKey, boolean>,
      clearMissing: Record<TrackKey, boolean>,
      work: Record<TrackKey, SpectrogramLaneWork>,
    ) => {
      const encoder = device.createCommandEncoder({
        label: 'processor-render-encoder',
      });
      for (const key of allTrackKeys) {
        if (clearMissing[key]) {
          runtime.tracks[key].lane.clear(encoder);
        }
      }
      for (const key of allTrackKeys) {
        if (!presence[key] || !dirty[key]) {
          continue;
        }
        const trackWork = work[key];
        if (!trackWork.spectrogram && !trackWork.fundamental) {
          continue;
        }
        runtime.tracks[key].lane.clearSignal(encoder, trackWork);
      }
      for (const stage of spectrumStages) {
        dispatchSpectrumStage(encoder, {
          dirty,
          marker: markers.getGpuMarker(stage),
          presence,
          runtime,
          stage,
          work,
        });
      }
      dispatchFundamentalFrequency(encoder, {
        dirty,
        marker: markers.getGpuMarker('fundamentalFrequency'),
        presence,
        runtime,
      });
      dispatchRemap(encoder, {
        clearMissing,
        dirty,
        marker: markers.getGpuMarker('remap'),
        presence,
        runtime,
      });
      runtime.draw.run(encoder);
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

  const lastRendered: Record<TrackKey, boolean> = createTrackFlags();
  const pendingDirty = new Set<TrackKey>();
  const pendingContentChanged = new Set<TrackKey>();
  const lastSamples: Record<TrackKey, Float32Array | undefined> =
    allTrackKeys.reduce(
      (acc, key) => {
        acc[key] = undefined;
        return acc;
      },
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      {} as Record<TrackKey, Float32Array | undefined>,
    );

  const render = markers.total(
    async (samples: SpectrogramSamples, trackProgress: number) => {
      const runtime = configurator.configure();
      if (!runtime) {
        return false;
      }
      timer.configure();
      const work = createTrackWork(runtime);
      for (const key of allTrackKeys) {
        const current = samples[key];
        if (current !== undefined && lastSamples[key] !== current) {
          pendingContentChanged.add(key);
          pendingDirty.add(key);
        }
      }
      const dirty = createTrackFlags();
      const contentChanged = createTrackFlags();
      const noExplicitDirty = pendingDirty.size === 0;
      for (const key of allTrackKeys) {
        if (noExplicitDirty) {
          dirty[key] = samples[key] !== undefined;
        } else if (pendingDirty.has(key)) {
          dirty[key] = samples[key] !== undefined;
        }
        if (pendingContentChanged.has(key)) {
          contentChanged[key] = samples[key] !== undefined;
        }
      }
      const presence: Record<TrackKey, boolean> = createTrackFlags();
      const clearMissing: Record<TrackKey, boolean> = createTrackFlags();
      for (const key of allTrackKeys) {
        const has = samples[key] !== undefined;
        presence[key] = has;
        clearMissing[key] = dirty[key] && !has && lastRendered[key];
      }
      writeBuffers(
        runtime,
        samples,
        trackProgress,
        dirty,
        contentChanged,
        work,
      );
      const command = createCommand(
        runtime,
        dirty,
        presence,
        clearMissing,
        work,
      );
      await submitCommand(command);
      for (const key of allTrackKeys) {
        if (dirty[key] || clearMissing[key]) {
          lastRendered[key] = presence[key];
          lastSamples[key] = samples[key];
        }
      }
      pendingDirty.clear();
      pendingContentChanged.clear();
      return true;
    },
  );

  return {
    render: createCallLatest(
      async (samples: SpectrogramSamples, trackProgress: number) => {
        const ok = await render(samples, trackProgress);
        if (!ok) {
          return false;
        }
        await timer.finish();
        return true;
      },
    ),
    invalidateSamples: (invalidations) => {
      for (const invalidation of invalidations) {
        pendingDirty.add(invalidation.trackKey);
        if (invalidation.frameCount > 0) {
          pendingContentChanged.add(invalidation.trackKey);
        }
      }
    },
    updateConfig: configurator.updateConfig,
    dispose: () => {
      timer.dispose();
      configurator.dispose();
    },
  };
};
