import { type SpectrogramViewMode } from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { type MeasureLatency, readMeasureLatency } from './latency.js';
import { epochNow } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

const latencyReadDelayMs = 2000;

export type DelayOptions = {
  projectId: number;
  seconds: number;
  startSeconds: number;
  view: SpectrogramViewMode;
};

export type DelayRun = {
  sampleRate: number;
  view: SpectrogramViewMode;
  startedAt: number;
  stoppedAt: number;
  arrivals: [
    captureEpochMs: number,
    arrivalEpochMs: number,
    frameCount: number,
    sampleRate: number,
  ][];
  latency: MeasureLatency;
  latencyDuring?: MeasureLatency;
};

export const measureDelayTake = async (
  hooks: PageHooks,
  options: DelayOptions,
): Promise<DelayRun> => {
  const { engine } = hooks;
  const { sampleRate } = engine.context;
  const latency = readMeasureLatency(engine);
  const arrivals: DelayRun['arrivals'] = [];
  let startedAt = 0;
  let stoppedAt = 0;
  let latencyDuring: MeasureLatency | undefined = undefined;

  await recordTemporaryTake(
    engine,
    {
      projectId: options.projectId,
      startFrame: Math.round(options.startSeconds * sampleRate),
      seconds: options.seconds,
      tempo: 1,
      songVolume: 0,
      metronome: false,
      view: options.view,
    },
    () => {
      startedAt = epochNow();
      const unsubscribe = hooks.listenCaptured((chunk) => {
        arrivals.push([
          performance.timeOrigin + chunk.startMs,
          epochNow(),
          chunk.samples.length,
          chunk.sampleRate,
        ]);
      });
      const latencyTimeout = setTimeout(() => {
        latencyDuring = readMeasureLatency(engine);
      }, latencyReadDelayMs);
      return () => {
        stoppedAt = epochNow();
        clearTimeout(latencyTimeout);
        unsubscribe();
      };
    },
  );

  return {
    sampleRate,
    view: options.view,
    startedAt,
    stoppedAt,
    arrivals,
    latency,
    latencyDuring,
  };
};
