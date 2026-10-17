import {
  estimateInputLatency,
  type InputLatencyEstimate,
} from '@musetric/audio/recording';
import { type EngineMicrophone } from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';

export type InputLatencyEstimateOptions = {
  context: AudioContext;
  microphone: EngineMicrophone;
  devices?: MediaDeviceInfo[];
};

export type AppliedInputLatencyEstimate = InputLatencyEstimate & {
  inputLatencyFrameCount: number;
};

export const applyInputLatencyEstimate = (
  store: Store<EngineState>,
  options: InputLatencyEstimateOptions,
): AppliedInputLatencyEstimate => {
  const { context, microphone } = options;
  const state = store.get();
  const estimate = estimateInputLatency({
    microphone: microphone.getSettings(),
    measuredInputLatency: microphone.getMeasuredInputLatency(),
    devices: options.devices ?? state.audioDevices,
    outputDeviceId: state.audioOutputDeviceId,
  });
  const inputLatencyFrameCount = Math.round(
    estimate.inputLatencySeconds * context.sampleRate,
  );
  const timedRoundTripFrameCount =
    microphone.exactRoundTripLatency === undefined
      ? undefined
      : Math.round(microphone.exactRoundTripLatency * context.sampleRate);
  const outputLatencyFloorFrameCount = Math.round(
    Math.max(
      estimate.outputLatencyFloorSeconds,
      microphone.outputLatency ?? 0,
    ) * context.sampleRate,
  );

  store.update((draft) => {
    draft.inputLatencyFrameCount = inputLatencyFrameCount;
    draft.timedRoundTripFrameCount = timedRoundTripFrameCount;
    draft.outputLatencyFloorFrameCount = outputLatencyFloorFrameCount;
    draft.latencyDevicePairKey = estimate.devicePairKey;
  });

  return { ...estimate, inputLatencyFrameCount };
};
