import { resolveAudioInputDevice } from '@musetric/audio/recording';
import {
  clearMicrophoneDenial,
  reportMicrophoneFailure,
} from '../audioSession/access.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';
import { applyInputLatencyEstimate } from './estimate.js';

const meterScale = 8;

const computeRmsLevel = (analyser: AnalyserNode) => {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * meterScale);
};

export type CalibrationPreviewOptions = {
  context: AudioContext;
  audioSession: EngineAudioSession;
  store: Store<EngineState>;
  refreshDevices: () => Promise<MediaDeviceInfo[]>;
};

export type CalibrationPreview = {
  open: () => () => void;
  getMicrophone: () => EngineMicrophone | undefined;
};

export const createCalibrationPreview = (
  options: CalibrationPreviewOptions,
): CalibrationPreview => {
  const { context, audioSession, store, refreshDevices } = options;
  let activeMicrophone: EngineMicrophone | undefined = undefined;

  const open = () => {
    const lifecycle = { cancelled: false, generation: 0 };
    let source: AudioNode | undefined = undefined;
    let analyser: AnalyserNode | undefined = undefined;
    let animationFrame: number | undefined = undefined;

    const stopMeter = () => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
      }
      source?.disconnect();
      source = undefined;
      analyser?.disconnect();
      analyser = undefined;
    };

    const teardown = () => {
      stopMeter();
      if (activeMicrophone) {
        audioSession.closeMicrophone(activeMicrophone);
        activeMicrophone = undefined;
      }
      store.update((draft) => {
        draft.inputLevel = 0;
      });
    };

    const updateLevel = () => {
      if (lifecycle.cancelled || !analyser) {
        return;
      }
      const level = computeRmsLevel(analyser);
      store.update((draft) => {
        draft.inputLevel = level;
      });
      animationFrame = requestAnimationFrame(updateLevel);
    };

    const failInput = (error: unknown) => {
      console.error('Failed to open microphone preview', error);
      if (
        lifecycle.cancelled ||
        reportMicrophoneFailure(store, audioSession, error)
      ) {
        return;
      }
      store.update((draft) => {
        draft.calibrationError = 'preview';
      });
    };

    const openInput = async () => {
      const current = ++lifecycle.generation;
      const isStale = (): boolean =>
        lifecycle.cancelled || current !== lifecycle.generation;
      stopMeter();
      if (activeMicrophone) {
        audioSession.closeMicrophone(activeMicrophone);
        activeMicrophone = undefined;
      }
      store.update((draft) => {
        draft.inputLevel = 0;
        draft.calibrationError = undefined;
      });

      try {
        if (context.state === 'suspended') {
          await context.resume();
        }
        if (isStale()) {
          return;
        }

        const devices = await refreshDevices();
        if (isStale()) {
          return;
        }
        const inputDevice = resolveAudioInputDevice(devices, {
          explicitDeviceId: store.get().microphoneDeviceId,
        });
        const microphone = await audioSession.openMicrophone({
          deviceId: inputDevice?.deviceId,
        });
        if (isStale()) {
          audioSession.closeMicrophone(microphone);
          return;
        }
        activeMicrophone = microphone;
        clearMicrophoneDenial(store);

        const refreshedDevices = await refreshDevices();
        if (isStale() || activeMicrophone !== microphone) {
          return;
        }
        const expectedInputDevice = resolveAudioInputDevice(refreshedDevices, {
          explicitDeviceId: store.get().microphoneDeviceId,
        });
        const currentDeviceId = microphone.getSettings().deviceId;
        let previewMicrophone = microphone;
        if (
          expectedInputDevice &&
          currentDeviceId &&
          expectedInputDevice.deviceId !== currentDeviceId
        ) {
          audioSession.closeMicrophone(microphone);
          activeMicrophone = undefined;
          previewMicrophone = await audioSession.openMicrophone({
            deviceId: expectedInputDevice.deviceId,
          });
          if (isStale()) {
            audioSession.closeMicrophone(previewMicrophone);
            return;
          }
          activeMicrophone = previewMicrophone;
        }

        applyInputLatencyEstimate(store, {
          context,
          microphone: previewMicrophone,
        });
        void previewMicrophone.whenInputLatencyMeasured().then(() => {
          if (!isStale()) {
            applyInputLatencyEstimate(store, {
              context,
              microphone: previewMicrophone,
            });
          }
        });

        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source = previewMicrophone.createSource();
        source.connect(analyser);
        updateLevel();
      } catch (error) {
        failInput(error);
      }
    };

    const trackedInputDeviceId = (state: EngineState) =>
      state.microphoneDeviceId;
    const trackedOutputDeviceId = (state: EngineState) =>
      state.audioOutputDeviceId;

    const unsubscribeInput = store.subscribe(trackedInputDeviceId, () => {
      void openInput();
    });
    const unsubscribeOutput = store.subscribe(trackedOutputDeviceId, () => {
      void openInput();
    });
    const unsubscribeDenial = store.subscribe(
      (state) => state.microphoneDenial,
      (denial) => {
        if (denial === undefined && !activeMicrophone) {
          void openInput();
        }
      },
    );

    void openInput();

    return () => {
      lifecycle.cancelled = true;
      unsubscribeInput();
      unsubscribeOutput();
      unsubscribeDenial();
      teardown();
    };
  };

  return {
    open,
    getMicrophone: () => activeMicrophone,
  };
};
