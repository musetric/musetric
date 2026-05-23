import { createCallLatest } from '@musetric/resource-utils';
import {
  createSpectrogramProcessorTimer,
  type SpectrogramProcessorMetrics,
} from './common/processorTimer.js';
import { type SpectrogramConfig } from './config.cross.js';
import {
  createSpectrogramConfigurator,
  type SpectrogramRuntime,
} from './configurator.js';
import { type SpectrogramLane } from './lane/index.js';

export type SpectrogramProcessor = {
  render: (
    samples: Float32Array,
    trackProgress: number,
    recordingSamples?: Float32Array,
  ) => Promise<boolean>;
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
  const { markers } = timer;

  const configurator = createSpectrogramConfigurator(device, markers);
  configurator.updateConfig(config);

  const writeBuffers = markers.writeBuffers(
    (
      leadLane: SpectrogramLane,
      recordingLane: SpectrogramLane,
      samples: Float32Array,
      trackProgress: number,
      recordingSamples: Float32Array | undefined,
    ) => {
      leadLane.writeSamples(samples, trackProgress);
      if (recordingSamples) {
        recordingLane.writeSamples(recordingSamples, trackProgress);
      }
    },
  );
  const createCommand = markers.createCommand(
    (
      runtime: SpectrogramRuntime,
      hasRecordingSamples: boolean,
      shouldClearRecordingFrequencies: boolean,
    ) => {
      const encoder = device.createCommandEncoder({
        label: 'processor-render-encoder',
      });
      runtime.leadLane.run(encoder);
      if (hasRecordingSamples) {
        runtime.recordingLane.run(encoder);
      } else {
        runtime.recordingLane.skip(encoder, shouldClearRecordingFrequencies);
      }
      runtime.remap.run(encoder);
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

  let hasRenderedRecordingFrequencies = false;

  const render = markers.total(
    async (
      samples: Float32Array,
      trackProgress: number,
      recordingSamples?: Float32Array,
    ) => {
      const runtime = configurator.configure();
      if (!runtime) {
        return false;
      }
      writeBuffers(
        runtime.leadLane,
        runtime.recordingLane,
        samples,
        trackProgress,
        recordingSamples,
      );
      const hasRecordingSamples = recordingSamples !== undefined;
      const shouldClearRecordingFrequencies =
        !hasRecordingSamples && hasRenderedRecordingFrequencies;
      const command = createCommand(
        runtime,
        hasRecordingSamples,
        shouldClearRecordingFrequencies,
      );
      await submitCommand(command);
      hasRenderedRecordingFrequencies = hasRecordingSamples;
      return true;
    },
  );

  return {
    render: createCallLatest(
      async (samples, trackProgress, recordingSamples?) => {
        const ok = await render(samples, trackProgress, recordingSamples);
        if (!ok) {
          return false;
        }
        await timer.finish();
        return true;
      },
    ),
    updateConfig: configurator.updateConfig,
    dispose: () => {
      timer.dispose();
      configurator.dispose();
    },
  };
};
