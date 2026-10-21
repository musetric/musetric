import { type PageHooks } from './hooks.js';
import { type MeasureLatency, readMeasureLatency } from './latency.js';
import { encodeSamples, epochNow, joinSamples } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

const minimumBeatCount = 8;
const startBeforeBeatSeconds = 0.15;
const latencyReadDelayMs = 2000;

const getStartFrame = (beats: readonly number[], sampleRate: number) => {
  if (beats.length < minimumBeatCount) {
    throw new Error('The song has too few beats for the timing measurement');
  }
  const beat = beats[Math.floor(beats.length / 3)];
  return Math.round((beat - startBeforeBeatSeconds) * sampleRate);
};

export type TimingOptions = {
  projectId: number;
  seconds: number;
  tempo: number;
};

export type TimingRun = {
  sampleRate: number;
  tempo: number;
  startFrame: number;
  beatFrames: number[];
  playhead: [epochMs: number, frameIndex: number, playing: number][];
  captured: {
    sampleRate: number;
    samples: string;
    chunks: [offset: number, epochMs: number][];
  };
  take: { firstFrame: number; samples: string };
  latency: MeasureLatency;
  latencyDuring?: MeasureLatency;
};

export const measureTimingTake = async (
  hooks: PageHooks,
  options: TimingOptions,
): Promise<TimingRun> => {
  const { engine } = hooks;
  const { sampleRate } = engine.context;
  const beats = engine.store.get().metronomeBeats;
  const startFrame = getStartFrame(beats, sampleRate);
  const latency = readMeasureLatency(engine);
  const playhead: TimingRun['playhead'] = [];
  const parts: Float32Array[] = [];
  const chunks: TimingRun['captured']['chunks'] = [];
  let capturedRate = sampleRate;
  let capturedLength = 0;
  let latencyDuring: MeasureLatency | undefined = undefined;

  const take = await recordTemporaryTake(
    engine,
    {
      projectId: options.projectId,
      startFrame,
      seconds: options.seconds,
      tempo: options.tempo,
      songVolume: 0,
      metronome: true,
    },
    () => {
      const unsubscribePlayhead = engine.store.subscribe(
        (state) => state.frameIndex,
        (frameIndex) => {
          playhead.push([
            epochNow(),
            frameIndex,
            engine.store.get().playing ? 1 : 0,
          ]);
        },
      );
      const unsubscribeCaptured = hooks.listenCaptured((chunk) => {
        capturedRate = chunk.sampleRate;
        chunks.push([capturedLength, performance.timeOrigin + chunk.startMs]);
        parts.push(chunk.samples.slice());
        capturedLength += chunk.samples.length;
      });
      const latencyTimeout = setTimeout(() => {
        latencyDuring = readMeasureLatency(engine);
      }, latencyReadDelayMs);
      return () => {
        clearTimeout(latencyTimeout);
        unsubscribePlayhead();
        unsubscribeCaptured();
      };
    },
  );

  return {
    sampleRate,
    tempo: options.tempo,
    startFrame,
    beatFrames: beats.map((beat) => Math.round(beat * sampleRate)),
    playhead,
    captured: {
      sampleRate: capturedRate,
      samples: encodeSamples(joinSamples(parts)),
      chunks,
    },
    take: { firstFrame: take.firstFrame, samples: encodeSamples(take.samples) },
    latency,
    latencyDuring,
  };
};
