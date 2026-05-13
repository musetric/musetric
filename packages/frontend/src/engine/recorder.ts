import {
  createMicrophoneAudioConstraints,
  getInitialMicrophoneLatencyFrameCount,
} from '@musetric/audio/recording';
import type { Store } from '../common/store.js';
import type { EngineDecoder } from './decoder.js';
import type { EnginePlayer } from './player.js';
import type { EngineState } from './state.js';

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
  unsubscribeSeek?: () => void;
  unsubscribePlayback?: () => void;
};

export type EngineRecorder = {
  start: (projectId: number) => Promise<void>;
  stop: () => Promise<void>;
};

export type CreateEngineRecorderOptions = {
  context: AudioContext;
  store: Store<EngineState>;
  getDecoder: () => EngineDecoder;
  getPlayer: () => EnginePlayer;
};

const recordingBufferSeconds = 10;

const stopMediaStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

export const createEngineRecorder = (
  options: CreateEngineRecorderOptions,
): EngineRecorder => {
  const { context, store, getDecoder, getPlayer } = options;
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
    session.unsubscribeSeek?.();
    session.unsubscribeSeek = undefined;
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
      ? await getPlayer().flushRecording()
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
    const frameIndex = await getPlayer().pause();

    if (!session.decoderStreamStarted) {
      return;
    }

    if (session.playerStreamStarted) {
      await closeDecoderStream(session);
      getPlayer().seek(frameIndex);
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

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: createMicrophoneAudioConstraints({
          deviceId: store.get().microphoneDeviceId,
          sampleRate: context.sampleRate,
        }),
      });
      session.stream = stream;
      if (!store.get().microphoneLatencyUserSet) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const latencyFrameCount = getInitialMicrophoneLatencyFrameCount(
          context,
          stream,
          devices,
        );
        store.update((state) => {
          state.microphoneLatencyFrameCount = latencyFrameCount;
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
      const latencyFrameCount = store.get().microphoneLatencyFrameCount;
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
      getPlayer().startRecording({
        frameIndex: startFrameIndex,
        latencyFrameCount,
        samples: recordingSamples,
        metadata: recordingMetadata,
        notificationPort: recordingStreamChannel.port2,
      });
      session.playerStreamStarted = true;

      session.unsubscribeSeek = store.subscribe(
        (state) => state.seekRevision,
        () => {
          getPlayer().seekRecording(store.get().frameIndex);
        },
      );
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
      const disconnectPlayerInput = getPlayer().connectRecordingSource(gain);
      session.disconnectPlayerInput = () => {
        disconnectPlayerInput();
        source.disconnect(gain);
        gain.disconnect();
      };

      if (isStopRequested(session)) {
        return;
      }

      await getPlayer().play();
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
    start: async (projectId) => {
      if (currentSession) {
        return currentSession.initializePromise;
      }

      const session = createSession(projectId);
      currentSession = session;
      setRecording(true);
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
