import { waitWithTimeout } from '@musetric/utils/cross/waitWithTimeout';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  clearMicrophoneDenial,
  reportMicrophoneFailure,
} from '../audioSession/access.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../audioSession/engineAudioSession.js';
import { applyInputLatencyEstimate } from '../calibration/estimate.js';
import { type Store } from '../common/store.js';
import { type EngineProject } from '../project/index.js';
import {
  type EngineState,
  getInputShareFrameCount,
  getRecordingLatencyFrameCount,
  isPlaying,
} from '../state.js';
import { settleLoopTry } from './loopTry.js';
import {
  openKnownMicrophone,
  resolvePreferredMicrophone,
} from './microphone.js';
import { type EnginePlayback } from './playback.js';
import { type EnginePosition } from './position.js';
import { type EngineSeeks } from './seeks.js';

const recordingFlushTimeoutMs = 2000;

type TakeRequest = {
  projectId: number;
  takeId: string;
  startPlayback: boolean;
  pass?: boolean;
};

type RecordingSession = Required<TakeRequest> & {
  passComplete: boolean;
  tempoRatio: number;
  initializePromise: Promise<void>;
  stopPromise?: Promise<void>;
  stopRequested: boolean;
  projectStreamStarted: boolean;
  projectStreamClosed: boolean;
  playerStreamStarted: boolean;
  microphone?: EngineMicrophone;
  disconnectPlayerInput?: () => void;
  unsubscribeRecordingGain?: () => void;
  unsubscribePlayback?: () => void;
};

export type EngineRecorder = {
  record: (request: TakeRequest) => Promise<boolean>;
  cancel: () => void;
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
  position: EnginePosition;
  seeks: EngineSeeks;
  endTake: () => void;
  getProject: () => EngineProject;
  getEnginePlayback: () => EnginePlayback;
};

export const createEngineRecorder = (
  options: CreateEngineRecorderOptions,
): EngineRecorder => {
  const { context, outputClock, audioSession, store, getProject } = options;
  const { getEnginePlayback, seeks } = options;
  let currentSession: RecordingSession | undefined = undefined;

  const isStopRequested = (session: RecordingSession) => session.stopRequested;

  const settleTry = async (session: RecordingSession) => {
    if (!session.pass) {
      return;
    }
    await settleLoopTry({
      store,
      project: getProject(),
      settled: session.projectStreamStarted,
      keep: session.passComplete,
      tempoRatio: session.tempoRatio,
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

  const closeProjectStream = async (session: RecordingSession) => {
    if (!session.projectStreamStarted) {
      return;
    }
    if (session.projectStreamClosed) {
      return;
    }
    session.projectStreamClosed = true;
    const sequence = session.playerStreamStarted
      ? ((await waitWithTimeout(
          getEnginePlayback().flushRecording(),
          recordingFlushTimeoutMs,
        )) ?? 0)
      : 0;
    await getProject().finishRecordingStream(session.takeId, sequence);
  };

  const failSession = (session: RecordingSession) => {
    void closeProjectStream(session).then(async () => settleTry(session));
    cleanupSession(session);
    if (currentSession === session) {
      currentSession = undefined;
    }
    options.endTake();
  };

  const stopInitializedSession = async (
    session: RecordingSession,
    keepPlaying: boolean,
  ) => {
    if (keepPlaying) {
      await closeProjectStream(session);
      return;
    }

    const frameIndex = await getEnginePlayback().stop();
    const { revision } = seeks.read();

    if (!session.projectStreamStarted) {
      return;
    }

    if (session.playerStreamStarted) {
      await closeProjectStream(session);
      if (seeks.read().revision === revision) {
        getEnginePlayback().seek(frameIndex);
      }
      return;
    }

    await closeProjectStream(session);
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
      await settleTry(session);
      options.endTake();
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
      await outputClock.wake();
      if (isStopRequested(session)) {
        return;
      }

      const { microphoneDeviceId } = store.get();
      let microphone = await openKnownMicrophone(
        audioSession,
        microphoneDeviceId,
      );
      session.microphone = microphone;
      clearMicrophoneDenial(store);
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

      const startFrameIndex = options.position.read();
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
      getProject().startRecordingStream({
        takeId: session.takeId,
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
      session.projectStreamStarted = true;
      getEnginePlayback().startRecording({
        frameIndex: startFrameIndex,
        revision: seeks.read().revision,
        latencyFrameCount,
        inputLatencyFrameCount,
        notificationPort: recordingStreamChannel.port2,
        pass: session.pass,
      });
      session.playerStreamStarted = true;

      session.unsubscribePlayback = store.subscribe(isPlaying, (playing) => {
        if (!playing && currentSession === session) {
          void requestSessionStop(session, false);
        }
      });
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
      reportMicrophoneFailure(store, audioSession, error);
      failSession(session);
      throw error;
    }
  };

  const createSession = (request: TakeRequest): RecordingSession => ({
    ...request,
    pass: request.pass === true,
    passComplete: false,
    tempoRatio: store.get().tempoRatio,
    initializePromise: Promise.resolve(),
    stopRequested: false,
    projectStreamStarted: false,
    projectStreamClosed: false,
    playerStreamStarted: false,
  });

  const ref: EngineRecorder = {
    record: async (request) => {
      if (currentSession) {
        const running = currentSession;
        await running.initializePromise;
        return running.playerStreamStarted;
      }
      const session = createSession(request);
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
      if (!session.playerStreamStarted) {
        cleanupSession(session);
        currentSession = undefined;
      }
      return session.playerStreamStarted;
    },
    cancel: () => {
      if (currentSession && !currentSession.playerStreamStarted) {
        currentSession.stopRequested = true;
      }
    },
    stop: async () => {
      const session = currentSession;
      if (!session) {
        options.endTake();
        return;
      }

      await requestSessionStop(session, false);
    },
    finish: async () => {
      const session = currentSession;
      if (!session) {
        options.endTake();
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
