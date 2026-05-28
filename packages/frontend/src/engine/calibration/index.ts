import {
  clampRecordingLatencyFrameCount,
  measureRecordingLatency,
} from '@musetric/audio/calibration';
import {
  getRecordingLatencyDevicePairKey,
  isLikelyMobileUserAgent,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import type { Store } from '../../common/store.js';
import type { EngineAudioOutput } from '../audioOutput/index.js';
import type { EnginePlayer } from '../player/index.js';
import type { EngineState } from '../state.js';
import { createCalibrationDevices } from './devices.js';
import { applyRecordingLatencyEstimate } from './estimate.js';
import microphoneCalibrationWorkletUrl from './microphone.worklet.ts?worker&url';
import {
  type CalibrationPreview,
  createCalibrationPreview,
} from './preview.js';
import {
  type CalibrationLatencyStore,
  createCalibrationLatencyStore,
} from './storage.js';

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

const restoreLatencyState = (
  store: Store<EngineState>,
  latencyStore: CalibrationLatencyStore,
  devicePairKey: string,
) => {
  const stored = latencyStore.get(devicePairKey);
  store.update((state) => {
    if (stored) {
      state.latencyFrameCount = stored.latencyFrameCount;
      state.inputLatencyFrameCount = stored.inputLatencyFrameCount;
      state.latencySource = stored.source;
      state.latencyDevicePairKey = devicePairKey;
    } else {
      state.latencySource = 'estimated';
      state.latencyDevicePairKey = undefined;
      state.inputLatencyFrameCount = 0;
    }
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
  const latencyStore = createCalibrationLatencyStore();

  const restoreForCurrentDevices = () => {
    const state = store.get();
    const inputDevice = resolveAudioInputDevice(state.audioDevices, {
      explicitDeviceId: state.microphoneDeviceId,
      preferBuiltIn: isLikelyMobileUserAgent(navigator.userAgent),
    });
    const outputDevice = resolveAudioOutputDevice(state.audioDevices, {
      explicitDeviceId: state.audioOutputDeviceId,
    });
    restoreLatencyState(
      store,
      latencyStore,
      getRecordingLatencyDevicePairKey(inputDevice, outputDevice),
    );
  };

  const devices = createCalibrationDevices({
    store,
    audioOutput,
    onInitialDevicePair: (devicePairKey) => {
      restoreLatencyState(store, latencyStore, devicePairKey);
    },
    onDeviceLost: (devicePairKey) => {
      restoreLatencyState(store, latencyStore, devicePairKey);
    },
    onActiveDeviceChanged: (devicePairKey) => {
      void stopActivePlayback(store, getPlayer());
      restoreLatencyState(store, latencyStore, devicePairKey);
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
    const stream = preview?.getStream();
    const estimate = stream
      ? applyRecordingLatencyEstimate(store, { context, stream })
      : undefined;
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

      const inputDevice = resolveAudioInputDevice(store.get().audioDevices, {
        explicitDeviceId: store.get().microphoneDeviceId,
        preferBuiltIn: isLikelyMobileUserAgent(navigator.userAgent),
      });
      const result = await measureRecordingLatency({
        context,
        outputNode: audioOutput.outputNode,
        playOutput: audioOutput.play,
        workletUrl: microphoneCalibrationWorkletUrl,
        deviceId: inputDevice?.deviceId,
        stream,
      });

      if (!result) {
        store.update((draft) => {
          draft.calibrationError = 'calibration';
        });
        return false;
      }

      latencyStore.set(estimate.devicePairKey, {
        latencyFrameCount: result.latencyFrameCount,
        inputLatencyFrameCount: estimate.inputLatencyFrameCount,
        source: 'calibrated',
      });

      store.update((draft) => {
        draft.latencyFrameCount = result.latencyFrameCount;
        draft.inputLatencyFrameCount = estimate.inputLatencyFrameCount;
        draft.latencySource = 'calibrated';
        draft.latencyDevicePairKey = estimate.devicePairKey;
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
      restoreForCurrentDevices();
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
        restoreForCurrentDevices();
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
        draft.latencyFrameCount = frameCount;
        draft.latencySource = 'manual';
        if (draft.latencyDevicePairKey === undefined) {
          draft.inputLatencyFrameCount = 0;
        }
      });
      const state = store.get();
      if (state.latencyDevicePairKey !== undefined) {
        latencyStore.set(state.latencyDevicePairKey, {
          latencyFrameCount: state.latencyFrameCount,
          inputLatencyFrameCount: state.inputLatencyFrameCount,
          source: 'manual',
        });
      }
    },
    calibrate: runCalibration,
    openPreview: () => getPreview().open(),
    isOutputSelectionSupported: () => audioOutput.supportsDeviceSelection,
  };
};
