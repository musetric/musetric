import { createThrottleTime } from '@musetric/resource-utils/cross/throttleTime';
import { getGpuDevice } from '../common/gpuDevice.js';
import {
  averageMetrics,
  type SpectrogramProcessorMetrics,
} from '../common/processorTimer.js';
import { allTrackKeys } from '../config.cross.js';
import { createSpectrogramProcessor } from '../processor.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
  type SpectrogramLaneSamples,
} from '../protocol.cross.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  profiling?: boolean;
};

const emptySamples = (): SpectrogramLaneSamples =>
  allTrackKeys.reduce<SpectrogramLaneSamples>((acc, key) => {
    acc[key] = undefined;
    return acc;
  }, {});

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, profiling } = options;

  const device = await getGpuDevice(profiling);

  const metricsBuffer: SpectrogramProcessorMetrics[] = [];
  const logMetrics = createThrottleTime(() => {
    console.table(averageMetrics(metricsBuffer.splice(0)));
  }, 500);

  const createProcessor = () =>
    createSpectrogramProcessor({
      device,
      onMetrics: profiling
        ? (metrics) => {
            metricsBuffer.push(metrics);
            logMetrics();
          }
        : undefined,
    });

  let processor = createProcessor();
  let samplesByLane: SpectrogramLaneSamples = emptySamples();
  let trackProgress = 0;

  const hasAnySamples = () =>
    allTrackKeys.some((key) => samplesByLane[key] !== undefined);

  const render = async () => {
    if (!hasAnySamples()) {
      return;
    }

    const ok = await processor.render(samplesByLane, trackProgress);
    if (!ok) {
      return;
    }
    port.methods.setState({
      status: 'success',
    });
  };

  dataPort.bindHandlers({
    mount: async (message) => {
      samplesByLane = { ...emptySamples(), ...message.samples };
      await render();
    },
    unmount: () => {
      samplesByLane = emptySamples();
      port.methods.setState({
        status: 'pending',
      });
    },
    samplesChanged: () => {
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
