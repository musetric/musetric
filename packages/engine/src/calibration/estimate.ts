import { estimateRecordingLatency } from '@musetric/audio/recording';
import { type EngineMicrophone } from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';

export type CalibrationEstimateOptions = {
  context: AudioContext;
  microphone: EngineMicrophone;
};

export const applyRecordingLatencyEstimate = (
  store: Store<EngineState>,
  options: CalibrationEstimateOptions,
): ReturnType<typeof estimateRecordingLatency> => {
  const state = store.get();
  const estimate = estimateRecordingLatency({
    context: options.context,
    microphone: options.microphone.getSettings(),
    outputLatency: options.microphone.outputLatency,
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
