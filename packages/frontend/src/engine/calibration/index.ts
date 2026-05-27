import {
  clampRecordingLatencyFrameCount,
  measureRecordingLatency,
} from '@musetric/audio/calibration';
import type { Store } from '../../common/store.js';
import type { EngineAudioOutput } from '../audioOutput/index.js';
import type { EnginePlayer } from '../player/index.js';
import type { EngineState } from '../state.js';
import { createCalibrationDevices } from './devices.js';
import microphoneCalibrationWorkletUrl from './microphone.worklet.ts?worker&url';
import {
  type CalibrationPreview,
  createCalibrationPreview,
} from './preview.js';

export type EngineCalibration = {
  selectInputDevice: (deviceId: string) => Promise<void>;
  selectOutputDevice: (deviceId: string) => Promise<void>;
  setManualLatencyMs: (latencyMs: number) => void;
  calibrate: () => Promise<boolean>;
  openPreview: () => () => void;
  isOutputSelectionSupported: () => boolean;
};

export type CreateEngineCalibrationOptions = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  store: Store<EngineState>;
  getPlayer: () => EnginePlayer;
};

const resetLatencyState = (store: Store<EngineState>) => {
  store.update((state) => {
    state.recordingLatencySource = 'estimated';
    state.recordingLatencyDevicePairKey = undefined;
  });
};

const stopActivePlayback = async (
  store: Store<EngineState>,
  player: EnginePlayer,
) => {
  if (store.get().playing) {
    await player.stop();
  }
};

export const createEngineCalibration = (
  options: CreateEngineCalibrationOptions,
): EngineCalibration => {
  const { context, audioOutput, store, getPlayer } = options;

  const devices = createCalibrationDevices({
    store,
    audioOutput,
    onDeviceLost: () => {
      resetLatencyState(store);
    },
    onActiveDeviceChanged: () => {
      void stopActivePlayback(store, getPlayer());
      resetLatencyState(store);
    },
  });
  devices.start();

  let preview: CalibrationPreview | undefined = undefined;
  const getPreview = (): CalibrationPreview => {
    preview ??= createCalibrationPreview({
      context,
      store,
      refreshDevices: async () => devices.refresh(),
    });
    return preview;
  };

  const runCalibration = async (): Promise<boolean> => {
    const state = store.get();
    const estimate = state.recordingLatencyEstimate;
    if (!estimate) {
      store.update((draft) => {
        draft.calibrationError = 'calibration';
      });
      return false;
    }

    store.update((draft) => {
      draft.calibrating = true;
      draft.calibrationError = undefined;
    });

    try {
      if (context.state === 'suspended') {
        await context.resume();
      }

      const result = await measureRecordingLatency({
        context,
        outputNode: audioOutput.outputNode,
        playOutput: audioOutput.play,
        workletUrl: microphoneCalibrationWorkletUrl,
        deviceId: state.microphoneDeviceId,
        stream: preview?.getStream(),
      });

      if (!result) {
        store.update((draft) => {
          draft.calibrationError = 'calibration';
        });
        return false;
      }

      store.update((draft) => {
        draft.recordingLatencyFrameCount = result.latencyFrameCount;
        draft.recordingLatencySource = 'calibrated';
        draft.recordingLatencyDevicePairKey = estimate.devicePairKey;
      });

      return true;
    } catch (error) {
      console.error('Failed to calibrate recording latency', error);
      store.update((draft) => {
        draft.calibrationError = 'calibration';
      });
      return false;
    } finally {
      store.update((draft) => {
        draft.calibrating = false;
      });
    }
  };

  return {
    selectInputDevice: async (deviceId) => {
      if (!deviceId || store.get().microphoneDeviceId === deviceId) {
        return;
      }
      store.update((draft) => {
        draft.calibrationError = undefined;
      });
      await stopActivePlayback(store, getPlayer());
      store.update((draft) => {
        draft.microphoneDeviceId = deviceId;
      });
      resetLatencyState(store);
    },
    selectOutputDevice: async (deviceId) => {
      if (!deviceId || store.get().audioOutputDeviceId === deviceId) {
        return;
      }
      store.update((draft) => {
        draft.calibrationError = undefined;
      });
      await stopActivePlayback(store, getPlayer());
      try {
        await audioOutput.setDeviceId(deviceId);
        store.update((draft) => {
          draft.audioOutputDeviceId = deviceId;
        });
        resetLatencyState(store);
      } catch (error) {
        console.error('Failed to select audio output', error);
        store.update((draft) => {
          draft.calibrationError = 'output';
        });
      }
    },
    setManualLatencyMs: (latencyMs) => {
      const frameCount = clampRecordingLatencyFrameCount(
        Math.round((latencyMs / 1000) * context.sampleRate),
        context.sampleRate,
      );
      store.update((draft) => {
        draft.recordingLatencyFrameCount = frameCount;
        draft.recordingLatencySource = 'manual';
        draft.recordingLatencyDevicePairKey =
          draft.recordingLatencyEstimate?.devicePairKey;
      });
    },
    calibrate: runCalibration,
    openPreview: () => getPreview().open(),
    isOutputSelectionSupported: () => audioOutput.supportsDeviceSelection,
  };
};
