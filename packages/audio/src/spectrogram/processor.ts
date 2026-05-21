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
import { type SpectrogramSliceSamples } from './sliceSamples/index.js';

export type SpectrogramProcessor = {
  render: (samples: Float32Array, trackProgress: number) => Promise<boolean>;
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
      sliceSamples: SpectrogramSliceSamples,
      samples: Float32Array,
      trackProgress: number,
    ) => {
      sliceSamples.write(samples, trackProgress);
    },
  );
  const createCommand = markers.createCommand((runtime: SpectrogramRuntime) => {
    const encoder = device.createCommandEncoder({
      label: 'processor-render-encoder',
    });
    runtime.sliceSamples.run(encoder);
    runtime.state.zerofyImag(encoder);
    runtime.windowing.run(encoder);
    runtime.fourier.forward(encoder);
    runtime.magnitudify.run(encoder);
    runtime.decibelify.run(encoder);
    runtime.fundamentalFrequency.run(encoder);
    runtime.remap.run(encoder);
    runtime.draw.run(encoder);
    timer.resolve(encoder);
    return encoder.finish();
  });

  const submitCommand = markers.submitCommand(
    async (command: GPUCommandBuffer) => {
      device.queue.submit([command]);
      await device.queue.onSubmittedWorkDone();
    },
  );

  const render = markers.total(
    async (samples: Float32Array, trackProgress: number) => {
      const runtime = configurator.configure();
      if (!runtime) {
        return false;
      }
      writeBuffers(runtime.sliceSamples, samples, trackProgress);
      const command = createCommand(runtime);
      await submitCommand(command);
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
