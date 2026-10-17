import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../audioSession/engineAudioSession.js';
import { applyInputLatencyEstimate } from '../calibration/estimate.js';
import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import {
  type EngineState,
  getInputShareFrameCount,
  getRecordingLatencyFrameCount,
} from '../state.js';
import { settleLoopTry } from './loopTry.js';
import {
  openKnownMicrophone,
  resolvePreferredMicrophone,
} from './microphone.js';
import { type EnginePlayback } from './playback.js';

type RecordingSession = {
  projectId: number;
  startPlayback: boolean;
  pass: boolean;
  passComplete: boolean;
  tempoRatio: number;
  initializePromise: Promise<void>;
  stopPromise?: Promise<void>;
  stopRequested: boolean;
  decoderStreamStarted: boolean;
  decoderStreamClosed: boolean;
  playerStreamStarted: boolean;
  microphone?: EngineMicrophone;
  disconnectPlayerInput?: () => void;
  unsubscribeRecordingGain?: () => void;
  unsubscribePlayback?: () => void;
};

export type EngineRecorder = {
  record: (
    projectId: number,
    startPlayback: boolean,
    pass?: boolean,
  ) => Promise<void>;
  stop: () => Promise<void>;
  finish: () => Promise<void>;
  handlePassStarted: () => void;
  handlePassEnded: (complete: boolean) => void;
};

export type CreateEngineRecorderOptions = {
  context: AudioContext;
  outputClock: EngineOutputClock;
  audioSession: EngineAudioSession;
  store: Store<EngineState>;
  getDecoder: () => EngineDecoder;
  getEnginePlayback: () => EnginePlayback;
};

export const createEngineRecorder = (
  options: CreateEngineRecorderOptions,
): EngineRecorder => {
  const { context, outputClock, audioSession, store, getDecoder } = options;
  const { getEnginePlayback } = options;
  let currentSession: RecordingSession | undefined = undefined;

  const setRecording = (recording: boolean) => {
    store.update((state) => {
      state.recording = recording;
    });
  };

  const isStopRequested = (session: RecordingSession) => session.stopRequested;

  const settleTry = async (session: RecordingSession, keepPlaying: boolean) => {
    if (!session.pass) {
      return;
    }
    await settleLoopTry({
      store,
      decoder: getDecoder(),
      settled: session.decoderStreamStarted,
      keep: session.passComplete,
      tempoRatio: session.tempoRatio,
      keepPlaying,
    });
  };

  const cleanupSession = (session: RecordingSession) => {
    session.disconnectPlayerInput?.();
    session.disconnectPlayerInput = undefined;
    session.unsubscribeRecordingGain?.();
    session.unsubscribeRecordingGain = undefined;
    session.unsubscribePlayback?.();
    session.unsubscribePlayback = undefined;
    if (session.microphone) {
      audioSession.closeMicrophone(session.microphone);
      session.microphone = undefined;
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
    void closeDecoderStream(session).then(async () =>
      settleTry(session, false),
    );
    cleanupSession(session);
    if (currentSession === session) {
      currentSession = undefined;
    }
    setRecording(false);
  };

  const stopInitializedSession = async (
    session: RecordingSession,
    keepPlaying: boolean,
  ) => {
    if (keepPlaying) {
      await closeDecoderStream(session);
      return;
    }

    const frameIndex = await getEnginePlayback().stop();
    const { revision } = store.get().seekEvent;

    if (!session.decoderStreamStarted) {
      return;
    }

    if (session.playerStreamStarted) {
      await closeDecoderStream(session);
      if (store.get().seekEvent.revision === revision) {
        getEnginePlayback().seek(frameIndex);
      }
      return;
    }

    await closeDecoderStream(session);
  };

  const stopSession = async (
    session: RecordingSession,
    keepPlaying: boolean,
  ) => {
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

      await stopInitializedSession(session, keepPlaying);
    } finally {
      cleanupSession(session);
      if (currentSession === session) {
        currentSession = undefined;
      }
      await settleTry(session, keepPlaying);
      setRecording(false);
    }
  };

  const requestSessionStop = async (
    session: RecordingSession,
    keepPlaying: boolean,
  ) => {
    session.stopPromise ??= stopSession(session, keepPlaying).finally(() => {
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

      const { microphoneDeviceId } = store.get();
      let microphone = await openKnownMicrophone(
        audioSession,
        microphoneDeviceId,
      );
      session.microphone = microphone;
      if (isStopRequested(session)) {
        return;
      }

      const devices = await audioSession.enumerateDevices();
      if (microphoneDeviceId === undefined) {
        microphone = await resolvePreferredMicrophone({
          audioSession,
          microphone,
          devices,
        });
        session.microphone = microphone;
        if (isStopRequested(session)) {
          return;
        }
      }

      await outputClock.whenSettled();
      await microphone.whenInputLatencyMeasured();
      if (isStopRequested(session)) {
        return;
      }
      applyInputLatencyEstimate(store, { context, microphone, devices });
      if (isStopRequested(session)) {
        return;
      }

      const startFrameIndex = store.get().frameIndex;
      const frameCount = store.get().frameCount ?? 0;
      const source = microphone.createSource();
      const gain = context.createGain();
      gain.gain.value = store.get().recordingGain;
      source.connect(gain);
      const disconnectPlayerInput =
        getEnginePlayback().connectRecordingSource(gain);
      session.disconnectPlayerInput = () => {
        disconnectPlayerInput();
        source.disconnect(gain);
        gain.disconnect();
      };
      const recordingStreamChannel = new MessageChannel();
      const { tempoRatio, transposeSemitones, voiceOctave } = store.get();
      const latencyFrameCount = getRecordingLatencyFrameCount(store.get());
      const inputLatencyFrameCount = getInputShareFrameCount(store.get());
      getDecoder().startRecordingStream({
        projectId: session.projectId,
        sampleRate: context.sampleRate,
        frameCount,
        latencyFrameCount,
        tempo: tempoRatio,
        transpose: transposeSemitones,
        octave: voiceOctave,
        draft: session.pass,
        port: recordingStreamChannel.port1,
      });
      session.decoderStreamStarted = true;
      getEnginePlayback().startRecording({
        frameIndex: startFrameIndex,
        revision: store.get().seekEvent.revision,
        latencyFrameCount,
        inputLatencyFrameCount,
        notificationPort: recordingStreamChannel.port2,
        pass: session.pass,
      });
      session.playerStreamStarted = true;

      session.unsubscribePlayback = store.subscribe(
        (state) => state.playing,
        (playing) => {
          if (!playing && currentSession === session) {
            void requestSessionStop(session, false);
          }
        },
      );
      session.unsubscribeRecordingGain = store.subscribe(
        (state) => state.recordingGain,
        (recordingGain) => {
          gain.gain.setValueAtTime(recordingGain, context.currentTime);
        },
      );

      if (isStopRequested(session) || !session.startPlayback) {
        return;
      }

      await getEnginePlayback().play();
    } catch (error) {
      failSession(session);
      throw error;
    }
  };

  const createSession = (
    projectId: number,
    startPlayback: boolean,
    pass: boolean,
  ): RecordingSession => ({
    projectId,
    startPlayback,
    pass,
    passComplete: false,
    tempoRatio: store.get().tempoRatio,
    initializePromise: Promise.resolve(),
    stopRequested: false,
    decoderStreamStarted: false,
    decoderStreamClosed: false,
    playerStreamStarted: false,
  });

  const ref: EngineRecorder = {
    record: async (projectId, startPlayback, pass) => {
      if (currentSession) {
        return currentSession.initializePromise;
      }

      const session = createSession(projectId, startPlayback, pass === true);
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

      await requestSessionStop(session, false);
    },
    finish: async () => {
      const session = currentSession;
      if (!session) {
        setRecording(false);
        return;
      }

      await requestSessionStop(session, true);
    },
    handlePassStarted: () => {
      if (currentSession?.pass) {
        store.update((state) => {
          state.loopTryPhase = 'writing';
        });
      }
    },
    handlePassEnded: (complete) => {
      const session = currentSession;
      if (session?.pass) {
        session.passComplete = complete;
        void requestSessionStop(session, true);
      }
    },
  };

  return ref;
};
