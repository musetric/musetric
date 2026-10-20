import { readTrackChunks } from '../audioSession/timedMicrophone.js';
import { type Engine } from '../engine.js';
import { type MeasureLatency, readMeasureLatency } from './latency.js';
import { encodeSamples, epochNow, joinSamples, wait } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

export type BrowserCaptureOptions = {
  seconds: number;
};

export type BrowserCapture = {
  sampleRate: number;
  label: string;
  settings: MediaTrackSettings;
  samples: string;
};

export const captureBrowserMicrophone = async (
  engine: Engine,
  options: BrowserCaptureOptions,
): Promise<BrowserCapture> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: engine.context.sampleRate,
    },
  });
  const [track] = stream.getAudioTracks();
  const source = readTrackChunks(track);
  if (!source) {
    throw new Error('This browser has no MediaStreamTrackProcessor');
  }
  const parts: Float32Array[] = [];
  let { sampleRate } = engine.context;
  const stop = source((chunk) => {
    ({ sampleRate } = chunk);
    parts.push(chunk.samples);
  });
  console.info('[measure]', 'started', epochNow());
  await wait(options.seconds * 1000);
  stop();
  for (const streamTrack of stream.getTracks()) {
    streamTrack.stop();
  }
  return {
    sampleRate,
    label: track.label,
    settings: track.getSettings(),
    samples: encodeSamples(joinSamples(parts)),
  };
};

export type SoundTakeOptions = {
  projectId: number;
  seconds: number;
  startSeconds: number;
  songVolume: number;
};

export type SoundTake = {
  sampleRate: number;
  firstFrame: number;
  samples: string;
  latency: MeasureLatency;
};

export const recordSoundTake = async (
  engine: Engine,
  options: SoundTakeOptions,
): Promise<SoundTake> => {
  const { sampleRate } = engine.context;
  const latency = readMeasureLatency(engine);
  const take = await recordTemporaryTake(engine, {
    projectId: options.projectId,
    startFrame: Math.round(options.startSeconds * sampleRate),
    seconds: options.seconds,
    tempo: 1,
    songVolume: options.songVolume,
    metronome: false,
  });
  return {
    sampleRate,
    firstFrame: take.firstFrame,
    samples: encodeSamples(take.samples),
    latency,
  };
};
