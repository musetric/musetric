import {
  createMicrophoneAudioConstraints,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';
import { applyRecordingLatencyEstimate } from './estimate.js';

const meterScale = 8;

const stopMediaStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

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
  store: Store<EngineState>;
  refreshDevices: () => Promise<MediaDeviceInfo[]>;
};

export type CalibrationPreview = {
  open: () => () => void;
  getStream: () => MediaStream | undefined;
};

export const createCalibrationPreview = (
  options: CalibrationPreviewOptions,
): CalibrationPreview => {
  const { context, store, refreshDevices } = options;
  let activeStream: MediaStream | undefined = undefined;

  const open = () => {
    const lifecycle = { cancelled: false, generation: 0 };
    let source: MediaStreamAudioSourceNode | undefined = undefined;
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
      if (activeStream) {
        stopMediaStream(activeStream);
        activeStream = undefined;
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

    const openStream = async () => {
      const current = ++lifecycle.generation;
      const isStale = (): boolean =>
        lifecycle.cancelled || current !== lifecycle.generation;
      stopMeter();
      if (activeStream) {
        stopMediaStream(activeStream);
        activeStream = undefined;
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
          preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
        });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: createMicrophoneAudioConstraints({
            deviceId: inputDevice?.deviceId,
            sampleRate: context.sampleRate,
          }),
        });
        if (isStale()) {
          stopMediaStream(stream);
          return;
        }
        activeStream = stream;

        const refreshedDevices = await refreshDevices();
        if (isStale() || activeStream !== stream) {
          return;
        }
        const expectedInputDevice = resolveAudioInputDevice(refreshedDevices, {
          explicitDeviceId: store.get().microphoneDeviceId,
          preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
        });
        const [track] = stream.getAudioTracks();
        const currentDeviceId = track.getSettings().deviceId;
        if (
          expectedInputDevice &&
          currentDeviceId &&
          expectedInputDevice.deviceId !== currentDeviceId
        ) {
          stopMediaStream(stream);
          activeStream = undefined;
          return;
        }

        applyRecordingLatencyEstimate(store, { context, stream });

        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        updateLevel();
      } catch (error) {
        console.error('Failed to open microphone preview', error);
        if (!lifecycle.cancelled) {
          store.update((draft) => {
            draft.calibrationError = 'preview';
          });
        }
      }
    };

    const trackedInputDeviceId = (state: EngineState) =>
      state.microphoneDeviceId;
    const trackedOutputDeviceId = (state: EngineState) =>
      state.audioOutputDeviceId;

    const unsubscribeInput = store.subscribe(trackedInputDeviceId, () => {
      void openStream();
    });
    const unsubscribeOutput = store.subscribe(trackedOutputDeviceId, () => {
      void openStream();
    });

    void openStream();

    return () => {
      lifecycle.cancelled = true;
      unsubscribeInput();
      unsubscribeOutput();
      teardown();
    };
  };

  return {
    open,
    getStream: () => activeStream,
  };
};
