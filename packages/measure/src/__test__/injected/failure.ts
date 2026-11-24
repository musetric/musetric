import {
  type Engine,
  getRecordingLatencyFrameCount,
  isPlaying,
  isRecording,
} from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { epochNow, wait } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

const pollMs = 5;
const bootTimeoutMs = 30_000;
const watchTimeoutMs = 5000;
const driftSeconds = 1;
const tailSeconds = 1;
const playSeconds = 1;
const songVolume = 0;
const noticeText = 'The sound stopped';

const waitForPlayer = async (engine: Engine) => {
  for (let waited = 0; waited < bootTimeoutMs; waited += pollMs) {
    const { statuses, frameCount } = engine.store.get();
    if (
      statuses.player === 'success' &&
      statuses.realtime === 'success' &&
      frameCount !== undefined
    ) {
      return;
    }
    await wait(pollMs);
  }
  throw new Error(
    `The player is ${engine.store.get().statuses.player} after the reload`,
  );
};

export type PlayerFault = 'caught' | 'uncaught';

const createFaultInjector = async (context: AudioContext) => {
  const name = `measure-fault-${Math.round(epochNow())}`;
  const source = `registerProcessor(${JSON.stringify(name)}, class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      globalThis.musetricMeasureHooks.injectPlayerFault(event.data);
    };
  }
  process() {
    return true;
  }
});`;
  const url = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' }),
  );
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, name, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
  });
  return (fault: PlayerFault) => {
    node.port.postMessage(fault);
  };
};

const isNoticeShown = () =>
  Array.from(document.querySelectorAll('[role="alert"]')).some((alert) =>
    alert.textContent.includes(noticeText),
  );

type FailureMoments = {
  failedMs?: number;
  stoppedMs?: number;
  takeEndedMs?: number;
  noticeMs?: number;
};

const watchFailure = async (
  engine: Engine,
  faultAt: number,
): Promise<FailureMoments> => {
  const moments: FailureMoments = {};
  const pending = () =>
    moments.failedMs === undefined ||
    moments.stoppedMs === undefined ||
    moments.takeEndedMs === undefined ||
    moments.noticeMs === undefined;
  while (pending() && epochNow() - faultAt < watchTimeoutMs) {
    const state = engine.store.get();
    const elapsed = epochNow() - faultAt;
    if (moments.failedMs === undefined && state.statuses.player === 'error') {
      moments.failedMs = elapsed;
    }
    if (moments.stoppedMs === undefined && !isPlaying(state)) {
      moments.stoppedMs = elapsed;
    }
    if (moments.takeEndedMs === undefined && !isRecording(state)) {
      moments.takeEndedMs = elapsed;
    }
    if (moments.noticeMs === undefined && isNoticeShown()) {
      moments.noticeMs = elapsed;
    }
    await wait(pollMs);
  }
  return moments;
};

export type FailureOptions = {
  projectId: number;
  fault: PlayerFault;
  startSeconds: number;
  faultSeconds: number;
};

type WatchedFault = FailureMoments & {
  faultSeconds: number;
};

export type FailureRun = WatchedFault & {
  fault: PlayerFault;
  sampleRate: number;
  latencyFrameCount: number;
  hostFrameCount: number;
  cursorDriftFrames: number;
};

export const measureFailure = async (
  hooks: PageHooks,
  options: FailureOptions,
): Promise<FailureRun> => {
  const { engine } = hooks;
  await waitForPlayer(engine);
  const inject = await createFaultInjector(engine.context);
  const { sampleRate } = engine.context;
  const latencyFrameCount = getRecordingLatencyFrameCount(engine.store.get());
  const watched = Promise.withResolvers<WatchedFault>();
  const take = await recordTemporaryTake(
    engine,
    {
      projectId: options.projectId,
      startFrame: Math.round(options.startSeconds * sampleRate),
      seconds: options.faultSeconds + tailSeconds,
      tempo: 1,
      songVolume,
      metronome: false,
    },
    () => {
      const started = epochNow();
      const timer = setTimeout(() => {
        const faultAt = epochNow();
        inject(options.fault);
        void watchFailure(engine, faultAt).then((moments) => {
          watched.resolve({
            ...moments,
            faultSeconds: (faultAt - started) / 1000,
          });
        }, watched.reject);
      }, options.faultSeconds * 1000);
      return () => {
        clearTimeout(timer);
      };
    },
  );
  const moments = await watched.promise;
  const held = engine.position.read();
  await wait(driftSeconds * 1000);
  return {
    ...moments,
    fault: options.fault,
    sampleRate,
    latencyFrameCount,
    hostFrameCount: take.hostFrameCount,
    cursorDriftFrames: engine.position.read() - held,
  };
};

export type RecoveryRun = {
  player: string;
  sampleRate: number;
  playedFrames: number;
};

export const measureRecovery = async (
  hooks: PageHooks,
): Promise<RecoveryRun> => {
  const { engine } = hooks;
  await waitForPlayer(engine);
  const from = engine.position.read();
  await engine.player.play();
  await wait(playSeconds * 1000);
  const playedFrames = engine.position.read() - from;
  await engine.player.stop();
  return {
    player: engine.store.get().statuses.player,
    sampleRate: engine.context.sampleRate,
    playedFrames,
  };
};
