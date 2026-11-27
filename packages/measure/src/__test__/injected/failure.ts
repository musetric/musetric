import { type Engine, isPlaying, isRecording } from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { setOutput } from './output.js';
import { epochNow, wait } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

const pollMs = 5;
const bootTimeoutMs = 30_000;
const watchTimeoutMs = 5000;
const driftSeconds = 1;
const tailSeconds = 1;
const takeTimeoutSeconds = 20;
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

type FaultTap = {
  inject: (fault: PlayerFault) => void;
  countSentFrames: () => Promise<number>;
};

const createFaultTap = async (context: AudioContext): Promise<FaultTap> => {
  const name = `measure-fault-${Math.round(epochNow())}`;
  const source = `let sentFrames = 0;
const post = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function (message, transfer) {
  if (message && message.type === 'chunk') {
    sentFrames += message.payload.samples.length;
  }
  return post.call(this, message, transfer);
};
registerProcessor(${JSON.stringify(name)}, class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data === 'count') {
        this.port.postMessage(sentFrames);
        return;
      }
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
  return {
    inject: (fault) => {
      node.port.postMessage(fault);
    },
    countSentFrames: async () =>
      new Promise<number>((resolve) => {
        node.port.onmessage = (event: MessageEvent<number>) => {
          resolve(event.data);
        };
        node.port.postMessage('count');
      }),
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

const watchFailure = (engine: Engine) => {
  const moments: FailureMoments = {};
  let faultAt = 0;
  const elapsed = () => epochNow() - faultAt;
  const unsubscribes = [
    engine.store.subscribe(
      (state) => state.statuses.player,
      (status) => {
        if (faultAt > 0 && status === 'error') {
          moments.failedMs ??= elapsed();
        }
      },
    ),
    engine.store.subscribe(isPlaying, (playing) => {
      if (faultAt > 0 && !playing) {
        moments.stoppedMs ??= elapsed();
      }
    }),
    engine.store.subscribe(isRecording, (recording) => {
      if (faultAt > 0 && !recording) {
        moments.takeEndedMs ??= elapsed();
      }
    }),
  ];
  const pollNotice = async () => {
    while (moments.noticeMs === undefined && elapsed() < watchTimeoutMs) {
      if (isNoticeShown()) {
        moments.noticeMs = elapsed();
      }
      await wait(pollMs);
    }
  };
  let noticePolled: Promise<void> | undefined = undefined;
  return {
    start: () => {
      faultAt = epochNow();
      noticePolled = pollNotice();
    },
    finish: async (): Promise<FailureMoments> => {
      await noticePolled;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      return moments;
    },
  };
};

export type FailureOptions = {
  projectId: number;
  fault: PlayerFault;
  startSeconds: number;
  faultSeconds: number;
};

export type FailureRun = FailureMoments & {
  fault: PlayerFault;
  sampleRate: number;
  sentFrameCount: number;
  hostFrameCount: number;
  cursorDriftFrames: number;
};

export const measureFailure = async (
  hooks: PageHooks,
  options: FailureOptions,
): Promise<FailureRun> => {
  const { engine } = hooks;
  await waitForPlayer(engine);
  const tap = await createFaultTap(engine.context);
  const { sampleRate } = engine.context;
  const watch = watchFailure(engine);
  const fault = { injected: false };
  const taking = recordTemporaryTake(
    engine,
    {
      projectId: options.projectId,
      startFrame: Math.round(options.startSeconds * sampleRate),
      seconds: options.faultSeconds + tailSeconds,
      tempo: 1,
      songVolume,
      metronome: false,
      output: 'silent',
    },
    () => {
      const timer = setTimeout(() => {
        fault.injected = true;
        watch.start();
        tap.inject(options.fault);
      }, options.faultSeconds * 1000);
      return () => {
        clearTimeout(timer);
      };
    },
  );
  const hung = Promise.withResolvers<never>();
  const hangTimer = setTimeout(
    () => {
      hung.reject(
        new Error(
          'The take did not end after the fault; its temporary recording is left in the project',
        ),
      );
    },
    (options.faultSeconds + takeTimeoutSeconds) * 1000,
  );
  const take = await Promise.race([taking, hung.promise]).finally(() => {
    clearTimeout(hangTimer);
  });
  if (!fault.injected) {
    throw new Error('The take ended before the fault');
  }
  const moments = await watch.finish();
  const held = engine.position.read();
  await wait(driftSeconds * 1000);
  return {
    ...moments,
    fault: options.fault,
    sampleRate,
    sentFrameCount: await tap.countSentFrames(),
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
  setOutput(engine, 'silent');
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
