import { getGpuDevice } from '../common/gpuDevice.js';
import { createSpectrogramProcessor } from '../processor.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
} from '../protocol.cross.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  profiling?: boolean;
};

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, profiling } = options;

  const device = await getGpuDevice(profiling);
  const createProcessor = () =>
    createSpectrogramProcessor({
      device,
      onMetrics: profiling
        ? (metrics) => {
            console.table(metrics);
          }
        : undefined,
    });

  let processor = createProcessor();
  let samples: Float32Array<SharedArrayBuffer> | undefined = undefined;
  let recordingSamples: Float32Array<SharedArrayBuffer> | undefined = undefined;
  let trackProgress = 0;

  const render = async () => {
    if (!samples) {
      return;
    }

    const ok = await processor.render(samples, trackProgress, recordingSamples);
    if (!ok) {
      return;
    }
    port.methods.setState({
      status: 'success',
    });
  };

  dataPort.bindHandlers({
    mount: async (message) => {
      samples = message.samples;
      recordingSamples = message.recordingSamples;
      await render();
    },
    unmount: () => {
      samples = undefined;
      recordingSamples = undefined;
      port.methods.setState({
        status: 'pending',
      });
    },
    recordingSamplesChanged: () => {
      void render();
    },
  });

  port.bindHandlers({
    mount: async (message) => {
      try {
        trackProgress = message.trackProgress;
        processor = createProcessor();
        processor.updateConfig(message.config);
        await render();
      } catch (error) {
        console.error('Failed to render spectrogram', error);
        port.methods.setState({
          status: 'error',
        });
      }
    },
    unmount: () => {
      processor.dispose();
      processor = createProcessor();
      trackProgress = 0;
      recordingSamples = undefined;
      port.methods.setState({
        status: 'pending',
      });
    },
    setTrackProgress: (message) => {
      trackProgress = message.trackProgress;
      void render();
    },
    updateConfig: (message) => {
      processor.updateConfig(message.patch);
      void render();
    },
  });
};
