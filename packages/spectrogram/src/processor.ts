import { createCallLatest } from '@musetric/resource-utils';
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

export type SpectrogramProcessor = {
  render: (
    samples: SpectrogramSamples,
    trackProgress: number,
  ) => Promise<boolean>;
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
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
    stage: SpectrumStage;
    work: Record<TrackKey, SpectrogramLaneWork>;
  },
) => {
  const { marker, presence, runtime, stage, work } = options;
  const pass = encoder.beginComputePass({
    label: `${stage}-pass`,
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (!presence[key]) {
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
    if (stage === 'windowing') {
      lane.dispatchWindowing(pass, trackWork);
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
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
  },
) => {
  const { marker, presence, runtime } = options;
  const pass = encoder.beginComputePass({
    label: 'fundamentalFrequency-pass',
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (presence[key] && runtime.config.lanes[key].showFundamental) {
      runtime.tracks[key].lane.dispatchFundamentalFrequency(pass);
    }
  }
  pass.end();
};

const dispatchRemap = (
  encoder: GPUCommandEncoder,
  options: {
    clearMissing: Record<TrackKey, boolean>;
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
  },
) => {
  const { clearMissing, marker, presence, runtime } = options;
  const pass = encoder.beginComputePass({
    label: 'remap-pass',
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (!runtime.config.lanes[key].showSpectrogram) {
      continue;
    }
    if (!presence[key] && !clearMissing[key]) {
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
      work: Record<TrackKey, SpectrogramLaneWork>,
    ) => {
      for (const key of allTrackKeys) {
        const trackSamples = samples[key];
        const trackWork = work[key];
        if (trackSamples && (trackWork.spectrogram || trackWork.fundamental)) {
          runtime.tracks[key].lane.writeSamples(
            trackSamples,
            trackProgress,
            trackWork,
          );
        }
      }
    },
  );
  const createCommand = markers.createCommand(
    (
      runtime: SpectrogramRuntime,
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
      for (const stage of spectrumStages) {
        dispatchSpectrumStage(encoder, {
          marker: markers.getGpuMarker(stage),
          presence,
          runtime,
          stage,
          work,
        });
      }
      dispatchFundamentalFrequency(encoder, {
        marker: markers.getGpuMarker('fundamentalFrequency'),
        presence,
        runtime,
      });
      dispatchRemap(encoder, {
        clearMissing,
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

  const render = markers.total(
    async (samples: SpectrogramSamples, trackProgress: number) => {
      const runtime = configurator.configure();
      if (!runtime) {
        return false;
      }
      timer.configure();
      const work = createTrackWork(runtime);
      writeBuffers(runtime, samples, trackProgress, work);
      const presence: Record<TrackKey, boolean> = createTrackFlags();
      const clearMissing: Record<TrackKey, boolean> = createTrackFlags();
      for (const key of allTrackKeys) {
        const has = samples[key] !== undefined;
        presence[key] = has;
        clearMissing[key] = !has && lastRendered[key];
      }
      const command = createCommand(runtime, presence, clearMissing, work);
      await submitCommand(command);
      for (const key of allTrackKeys) {
        lastRendered[key] = presence[key];
      }
      return true;
    },
  );

  return {
    render: createCallLatest(async (samples, trackProgress) => {
      const ok = await render(samples, trackProgress);
      if (!ok) {
        return false;
      }
      await timer.finish();
      return true;
    }),
    updateConfig: configurator.updateConfig,
    dispose: () => {
      timer.dispose();
      configurator.dispose();
    },
  };
};
