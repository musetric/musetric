import { estimateRecordingLatency } from '@musetric/audio/recording';
import type { Store } from '../../common/store.js';
import type { EngineState } from '../state.js';

export type CalibrationEstimateOptions = {
  context: AudioContext;
  stream: MediaStream;
};

export const applyRecordingLatencyEstimate = (
  store: Store<EngineState>,
  options: CalibrationEstimateOptions,
): void => {
  const state = store.get();
  const estimate = estimateRecordingLatency({
    context: options.context,
    stream: options.stream,
    devices: state.audioDevices,
    outputDeviceId: state.audioOutputDeviceId,
  });

  store.update((draft) => {
    draft.recordingLatencyEstimate = estimate;
    if (
      draft.recordingLatencySource === 'estimated' ||
      draft.recordingLatencyDevicePairKey !== estimate.devicePairKey
    ) {
      draft.recordingLatencyFrameCount = estimate.frameCount;
      draft.recordingLatencySource = 'estimated';
      draft.recordingLatencyDevicePairKey = estimate.devicePairKey;
    }
  });
};

export const clearRecordingLatencyEstimate = (store: Store<EngineState>) => {
  store.update((draft) => {
    draft.recordingLatencyEstimate = undefined;
  });
};
