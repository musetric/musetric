import {
  createMicrophoneAudioConstraints,
  estimateRecordingLatency,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';
import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import { type EngineState } from '../state.js';
import { type EnginePlayback } from './playback.js';

type RecordingSession = {
  projectId: number;
  initializePromise: Promise<void>;
  stopPromise?: Promise<void>;
  stopRequested: boolean;
  decoderStreamStarted: boolean;
  decoderStreamClosed: boolean;
  playerStreamStarted: boolean;
  stream?: MediaStream;
  disconnectPlayerInput?: () => void;
  unsubscribeRecordingGain?: () => void;
  unsubscribePlayback?: () => void;
};

export type EngineRecorder = {
  record: (projectId: number) => Promise<void>;
  stop: () => Promise<void>;
};

export type CreateEngineRecorderOptions = {
  context: AudioContext;
  store: Store<EngineState>;
  getDecoder: () => EngineDecoder;
  getEnginePlayback: () => EnginePlayback;
};

const recordingBufferSeconds = 10;

const stopMediaStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

const getAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

export const createEngineRecorder = (
  options: CreateEngineRecorderOptions,
): EngineRecorder => {
  const { context, store, getDecoder, getEnginePlayback } = options;
  let currentSession: RecordingSession | undefined = undefined;

  const setRecording = (recording: boolean) => {
    store.update((state) => {
      state.recording = recording;
    });
  };

  const isStopRequested = (session: RecordingSession) => session.stopRequested;

  const cleanupSession = (session: RecordingSession) => {
    session.disconnectPlayerInput?.();
    session.disconnectPlayerInput = undefined;
    session.unsubscribeRecordingGain?.();
    session.unsubscribeRecordingGain = undefined;
    session.unsubscribePlayback?.();
    session.unsubscribePlayback = undefined;
    if (session.stream) {
      stopMediaStream(session.stream);
      session.stream = undefined;
    }
  };

  const closeDecoderStream = async (session: RecordingSession) => {
    if (!session.decoderStreamStarted) {
      return;
    }
    if (session.decoderStreamClosed) {
      return;
    }
    session.decoderStreamClosed = true;
    const sequence = session.playerStreamStarted
      ? await getEnginePlayback().flushRecording()
      : 0;
    await getDecoder().finishRecordingStream(sequence);
  };

  const failSession = (session: RecordingSession) => {
    void closeDecoderStream(session);
    cleanupSession(session);
    if (currentSession === session) {
      currentSession = undefined;
    }
    setRecording(false);
  };

  const stopInitializedSession = async (session: RecordingSession) => {
    const frameIndex = await getEnginePlayback().stop();

    if (!session.decoderStreamStarted) {
      return;
    }

    if (session.playerStreamStarted) {
      await closeDecoderStream(session);
      getEnginePlayback().seek(frameIndex);
      return;
    }

    await closeDecoderStream(session);
  };

  const stopSession = async (session: RecordingSession) => {
    session.stopRequested = true;
    try {
      try {
        await session.initializePromise;
      } catch (error) {
        console.error('Failed to initialize recording', error);
      }

      if (currentSession !== session) {
        return;
      }

      await stopInitializedSession(session);
    } finally {
      cleanupSession(session);
      if (currentSession === session) {
        currentSession = undefined;
      }
      setRecording(false);
    }
  };

  const requestSessionStop = async (session: RecordingSession) => {
    session.stopPromise ??= stopSession(session).finally(() => {
      session.stopPromise = undefined;
    });
    await session.stopPromise;
  };

  const initializeSession = async (session: RecordingSession) => {
    try {
      if (context.state === 'suspended') {
        await context.resume();
      }
      if (isStopRequested(session)) {
        return;
      }

      let stream = await navigator.mediaDevices.getUserMedia({
        audio: createMicrophoneAudioConstraints({
          deviceId: store.get().microphoneDeviceId,
          sampleRate: context.sampleRate,
        }),
      });
      session.stream = stream;
      if (isStopRequested(session)) {
        return;
      }

      const devices = await getAudioDevices();
      if (store.get().microphoneDeviceId === undefined) {
        const preferredDevice = resolveAudioInputDevice(devices, {
          preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
        });
        if (preferredDevice) {
          const [currentTrack] = stream.getAudioTracks();
          const currentDeviceId = currentTrack.getSettings().deviceId;
          if (preferredDevice.deviceId !== currentDeviceId) {
            stopMediaStream(stream);
            stream = await navigator.mediaDevices.getUserMedia({
              audio: createMicrophoneAudioConstraints({
                deviceId: preferredDevice.deviceId,
                sampleRate: context.sampleRate,
              }),
            });
            session.stream = stream;
            if (isStopRequested(session)) {
              return;
            }
          }
        }
      }

      const estimate = estimateRecordingLatency({
        context,
        stream,
        devices,
        outputDeviceId: store.get().audioOutputDeviceId,
      });
      const latencyState = store.get();
      if (
        latencyState.latencySource === 'estimated' ||
        latencyState.latencyDevicePairKey !== estimate.devicePairKey
      ) {
        store.update((state) => {
          state.latencyFrameCount = estimate.frameCount;
          state.inputLatencyFrameCount = estimate.inputLatencyFrameCount;
          state.latencySource = 'estimated';
          state.latencyDevicePairKey = estimate.devicePairKey;
        });
      } else {
        store.update((state) => {
          state.inputLatencyFrameCount = estimate.inputLatencyFrameCount;
        });
      }
      if (isStopRequested(session)) {
        return;
      }

      const startFrameIndex = store.get().frameIndex;
      const frameCount = store.get().frameCount ?? 0;
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = store.get().recordingGain;
      source.connect(gain);
      const recordingStreamChannel = new MessageChannel();
      const recordingSamples = new Float32Array(
        new SharedArrayBuffer(
          Math.ceil(context.sampleRate * recordingBufferSeconds) *
            Float32Array.BYTES_PER_ELEMENT,
        ),
      );
      const recordingMetadata = new Int32Array(new SharedArrayBuffer(4));
      const { latencyFrameCount, inputLatencyFrameCount } = store.get();
      getDecoder().startRecordingStream({
        projectId: session.projectId,
        sampleRate: context.sampleRate,
        frameCount,
        latencyFrameCount,
        samples: recordingSamples,
        metadata: recordingMetadata,
        port: recordingStreamChannel.port1,
      });
      session.decoderStreamStarted = true;
      getEnginePlayback().startRecording({
        frameIndex: startFrameIndex,
        revision: store.get().seekEvent.revision,
        latencyFrameCount,
        inputLatencyFrameCount,
        samples: recordingSamples,
        metadata: recordingMetadata,
        notificationPort: recordingStreamChannel.port2,
      });
      session.playerStreamStarted = true;

      session.unsubscribePlayback = store.subscribe(
        (state) => state.playing,
        (playing) => {
          if (!playing && currentSession === session) {
            void requestSessionStop(session);
          }
        },
      );
      session.unsubscribeRecordingGain = store.subscribe(
        (state) => state.recordingGain,
        (recordingGain) => {
          gain.gain.setValueAtTime(recordingGain, context.currentTime);
        },
      );
      const disconnectPlayerInput =
        getEnginePlayback().connectRecordingSource(gain);
      session.disconnectPlayerInput = () => {
        disconnectPlayerInput();
        source.disconnect(gain);
        gain.disconnect();
      };

      if (isStopRequested(session)) {
        return;
      }

      await getEnginePlayback().play();
    } catch (error) {
      failSession(session);
      throw error;
    }
  };

  const createSession = (projectId: number) => {
    const session: RecordingSession = {
      projectId,
      initializePromise: Promise.resolve(),
      stopRequested: false,
      decoderStreamStarted: false,
      decoderStreamClosed: false,
      playerStreamStarted: false,
    };
    return session;
  };

  const ref: EngineRecorder = {
    record: async (projectId) => {
      if (currentSession) {
        return currentSession.initializePromise;
      }

      const session = createSession(projectId);
      currentSession = session;
      session.initializePromise = initializeSession(session);

      try {
        await session.initializePromise;
      } catch (error) {
        if (currentSession === session) {
          failSession(session);
        }
        throw error;
      }
    },
    stop: async () => {
      const session = currentSession;
      if (!session) {
        setRecording(false);
        return;
      }

      await requestSessionStop(session);
    },
  };

  return ref;
};
