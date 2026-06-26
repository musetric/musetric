import { estimateRecordingLatency } from '@musetric/audio/recording';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';

export type CalibrationEstimateOptions = {
  context: AudioContext;
  stream: MediaStream;
};

export const applyRecordingLatencyEstimate = (
  store: Store<EngineState>,
  options: CalibrationEstimateOptions,
): ReturnType<typeof estimateRecordingLatency> => {
  const state = store.get();
  const estimate = estimateRecordingLatency({
    context: options.context,
    stream: options.stream,
    devices: state.audioDevices,
    outputDeviceId: state.audioOutputDeviceId,
  });

  store.update((draft) => {
    if (
      draft.latencySource === 'estimated' ||
      draft.latencyDevicePairKey !== estimate.devicePairKey
    ) {
      draft.latencyFrameCount = estimate.frameCount;
      draft.latencySource = 'estimated';
      draft.latencyDevicePairKey = estimate.devicePairKey;
    }
    draft.inputLatencyFrameCount = estimate.inputLatencyFrameCount;
  });

  return estimate;
};
