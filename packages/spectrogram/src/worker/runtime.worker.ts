import { createThrottleTime } from '@musetric/resource-utils/cross/throttleTime';
import { getGpuDevice } from '../common/gpuDevice.js';
import {
  averageMetrics,
  type SpectrogramProcessorMetrics,
} from '../common/processorTimer.js';
import { allTrackKeys, type TrackKey } from '../config.cross.js';
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

  // The status is posted to the main thread after every render, but it almost
  // never changes between frames. Posting an identical 'success' ~60 times per
  // second was the dominant worker cost (cross-thread postMessage + main-thread
  // store churn), so only post when the status actually transitions.
  let lastStatus: 'pending' | 'error' | 'success' | undefined = undefined;
  const setStatus = (status: 'pending' | 'error' | 'success') => {
    if (status === lastStatus) {
      return;
    }
    lastStatus = status;
    port.methods.setState({ status });
  };

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

  const render = async (renderOptions?: {
    dirtyTracks?: readonly TrackKey[];
    contentChangedTracks?: readonly TrackKey[];
  }) => {
    if (!hasAnySamples()) {
      return;
    }

    const ok = await processor.render(samplesByLane, trackProgress, {
      dirtyTracks: renderOptions?.dirtyTracks,
      contentChangedTracks: renderOptions?.contentChangedTracks,
    });
    if (!ok) {
      return;
    }
    setStatus('success');
  };

  const presentTrackKeys = (): TrackKey[] =>
    allTrackKeys.filter((key) => samplesByLane[key] !== undefined);

  dataPort.bindHandlers({
    mount: async (message) => {
      samplesByLane = { ...emptySamples(), ...message.samples };
      await render({ contentChangedTracks: presentTrackKeys() });
    },
    unmount: () => {
      samplesByLane = emptySamples();
      setStatus('pending');
    },
    samplesChanged: (message) => {
      void render({
        dirtyTracks: [message.trackKey],
        contentChangedTracks: [message.trackKey],
      });
    },
  });

  port.bindHandlers({
    mount: async (message) => {
      try {
        trackProgress = message.trackProgress;
        processor.dispose();
        processor = createProcessor();
        processor.updateConfig(message.config);
        await render();
      } catch (error) {
        console.error('Failed to render spectrogram', error);
        setStatus('error');
      }
    },
    unmount: () => {
      processor.dispose();
      processor = createProcessor();
      trackProgress = 0;
      setStatus('pending');
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
