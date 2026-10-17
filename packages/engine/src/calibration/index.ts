import { clampRecordingLatencyFrameCount } from '@musetric/audio/calibration';
import {
  getRecordingLatencyDevicePairKey,
  isMobileUserAgent,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { type EngineAudioSession } from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EnginePlayer } from '../player/index.js';
import {
  type EngineState,
  getRecordingLatencyFrameCount,
  getReportedOutputLatencyFrameCount,
} from '../state.js';
import { createCalibrationDevices } from './devices.js';
import { applyInputLatencyEstimate } from './estimate.js';
import { measureRecordingLatency } from './measurement.js';
import microphoneCalibrationWorkletUrl from './microphone.worklet.ts?worker&url';
import {
  type CalibrationPreview,
  createCalibrationPreview,
} from './preview.js';
import { microphoneCalibrationProcessorName } from './protocol.cross.js';
import {
  type CalibrationLatencyStore,
  createCalibrationLatencyStore,
} from './storage.js';

const routeToleranceSeconds = 0.03;

const isSameRoute = (
  state: EngineState,
  outputLatencyFrameCount: number,
  sampleRate: number,
) =>
  Math.abs(state.outputLatencyFrameCount - outputLatencyFrameCount) <=
  routeToleranceSeconds * sampleRate;

const clearCorrection = (state: EngineState) => {
  state.outputCorrectionFrameCount = 0;
  state.correctedOutputLatencyFrameCount = undefined;
  state.latencySource = 'estimated';
};

const restoreLatencyState = (
  store: Store<EngineState>,
  latencyStore: CalibrationLatencyStore,
  devicePairKey: string,
  sampleRate: number,
) => {
  const stored = latencyStore.get(devicePairKey);
  store.update((state) => {
    state.latencyDevicePairKey = devicePairKey;
    if (
      stored &&
      isSameRoute(state, stored.outputLatencyFrameCount, sampleRate)
    ) {
      state.outputCorrectionFrameCount = stored.outputCorrectionFrameCount;
      state.correctedOutputLatencyFrameCount = stored.outputLatencyFrameCount;
      state.latencySource = stored.source;
    } else {
      clearCorrection(state);
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
  outputClock: EngineOutputClock;
  audioSession: EngineAudioSession;
  store: Store<EngineState>;
  getPlayer: () => EnginePlayer;
};

export const createEngineCalibration = (
  options: CreateEngineCalibrationOptions,
): EngineCalibration => {
  const { context, audioOutput, outputClock, audioSession, store } = options;
  const { getPlayer } = options;
  const { sampleRate } = context;
  const latencyStore = createCalibrationLatencyStore();

  const restore = (devicePairKey: string) => {
    restoreLatencyState(store, latencyStore, devicePairKey, sampleRate);
  };

  const saveCorrection = (
    targetLatencyFrameCount: number,
    source: 'manual' | 'calibrated',
  ) => {
    const state = store.get();
    const outputCorrectionFrameCount =
      targetLatencyFrameCount -
      state.inputLatencyFrameCount -
      getReportedOutputLatencyFrameCount(state);
    store.update((draft) => {
      draft.outputCorrectionFrameCount = outputCorrectionFrameCount;
      draft.correctedOutputLatencyFrameCount = draft.outputLatencyFrameCount;
      draft.latencySource = source;
    });
    if (state.latencyDevicePairKey !== undefined) {
      latencyStore.set(state.latencyDevicePairKey, {
        outputLatencyFrameCount: state.outputLatencyFrameCount,
        outputCorrectionFrameCount,
        source,
      });
    }
  };

  store.subscribe(
    (state) => state.latencyDevicePairKey,
    (devicePairKey) => {
      if (devicePairKey !== undefined) {
        restore(devicePairKey);
      }
    },
  );
  store.subscribe(
    (state) => state.outputLatencyFrameCount,
    () => {
      const state = store.get();
      const corrected = state.correctedOutputLatencyFrameCount;
      if (corrected === undefined) {
        if (state.latencyDevicePairKey !== undefined) {
          restore(state.latencyDevicePairKey);
        }
        return;
      }
      if (!isSameRoute(state, corrected, sampleRate)) {
        store.update(clearCorrection);
      }
    },
  );

  const restoreForCurrentDevices = () => {
    const state = store.get();
    const inputDevice = resolveAudioInputDevice(state.audioDevices, {
      explicitDeviceId: state.microphoneDeviceId,
      preferBuiltIn: isMobileUserAgent(navigator),
    });
    const outputDevice = resolveAudioOutputDevice(state.audioDevices, {
      explicitDeviceId: state.audioOutputDeviceId,
    });
    restore(getRecordingLatencyDevicePairKey(inputDevice, outputDevice));
  };

  const devices = createCalibrationDevices({
    store,
    audioOutput,
    audioSession,
    onInitialDevicePair: restore,
    onDeviceLost: restore,
    onActiveDeviceChanged: (devicePairKey) => {
      void stopActivePlayback(store, getPlayer());
      restore(devicePairKey);
    },
  });
  devices.start();

  let preview: CalibrationPreview | undefined = undefined;
  const getPreview = (): CalibrationPreview => {
    preview ??= createCalibrationPreview({
      context,
      audioSession,
      store,
      refreshDevices: async () => devices.refresh(),
    });
    return preview;
  };

  const runCalibration = async (): Promise<boolean> => {
    const microphone = preview?.getMicrophone();
    if (!microphone) {
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
      await outputClock.whenSettled();

      const inputDevice = resolveAudioInputDevice(store.get().audioDevices, {
        explicitDeviceId: store.get().microphoneDeviceId,
        preferBuiltIn: isMobileUserAgent(navigator),
      });
      const result = await measureRecordingLatency({
        context,
        audioSession,
        outputNode: audioOutput.outputNode,
        playOutput: audioOutput.play,
        workletUrl: microphoneCalibrationWorkletUrl,
        processorName: microphoneCalibrationProcessorName,
        deviceId: inputDevice?.deviceId,
        microphone,
      });

      if (!result) {
        store.update((draft) => {
          draft.calibrationError = 'calibration';
        });
        return false;
      }

      applyInputLatencyEstimate(store, { context, microphone });
      saveCorrection(result.latencyFrameCount, 'calibrated');

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
        Math.round((latencyMs / 1000) * sampleRate),
        sampleRate,
      );
      if (frameCount === getRecordingLatencyFrameCount(store.get())) {
        return;
      }
      saveCorrection(frameCount, 'manual');
    },
    calibrate: runCalibration,
    openPreview: () => getPreview().open(),
    isOutputSelectionSupported: () => audioOutput.supportsDeviceSelection,
  };
};
