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

const dispatchSpectrumStage = (
  encoder: GPUCommandEncoder,
  options: {
    marker?: GPUComputePassTimestampWrites;
    presence: Record<TrackKey, boolean>;
    runtime: SpectrogramRuntime;
    stage: SpectrumStage;
  },
) => {
  const { marker, presence, runtime, stage } = options;
  const pass = encoder.beginComputePass({
    label: `${stage}-pass`,
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    if (!presence[key]) {
      continue;
    }
    const { lane } = runtime.tracks[key];
    if (stage === 'sliceSamples') {
      lane.dispatchSliceSamples(pass);
    }
    if (stage === 'windowing') {
      lane.dispatchWindowing(pass);
    }
    if (stage === 'fourierTransform') {
      lane.dispatchFourierTransform(pass);
    }
    if (stage === 'magnitudify') {
      lane.dispatchMagnitudify(pass);
    }
    if (stage === 'decibelify') {
      lane.dispatchDecibelify(pass);
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
    if (presence[key]) {
      runtime.tracks[key].lane.dispatchFundamentalFrequency(pass);
    }
  }
  pass.end();
};

const dispatchRemap = (
  encoder: GPUCommandEncoder,
  options: {
    marker?: GPUComputePassTimestampWrites;
    runtime: SpectrogramRuntime;
  },
) => {
  const { marker, runtime } = options;
  const pass = encoder.beginComputePass({
    label: 'remap-pass',
    timestampWrites: marker,
  });
  for (const key of allTrackKeys) {
    runtime.tracks[key].remap.dispatch(pass);
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
    ) => {
      for (const key of allTrackKeys) {
        const trackSamples = samples[key];
        if (trackSamples) {
          runtime.tracks[key].lane.writeSamples(trackSamples, trackProgress);
        }
      }
    },
  );
  const createCommand = markers.createCommand(
    (
      runtime: SpectrogramRuntime,
      presence: Record<TrackKey, boolean>,
      clearMissing: Record<TrackKey, boolean>,
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
        });
      }
      dispatchFundamentalFrequency(encoder, {
        marker: markers.getGpuMarker('fundamentalFrequency'),
        presence,
        runtime,
      });
      dispatchRemap(encoder, {
        marker: markers.getGpuMarker('remap'),
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
      writeBuffers(runtime, samples, trackProgress);
      const presence: Record<TrackKey, boolean> = createTrackFlags();
      const clearMissing: Record<TrackKey, boolean> = createTrackFlags();
      for (const key of allTrackKeys) {
        const has = samples[key] !== undefined;
        presence[key] = has;
        clearMissing[key] = !has && lastRendered[key];
      }
      const command = createCommand(runtime, presence, clearMissing);
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
