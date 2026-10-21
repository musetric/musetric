import { type Engine } from '@musetric/engine';
import { type MeasureLatency, readMeasureLatency } from './latency.js';
import { encodeSamples, epochNow, joinSamples, wait } from './samples.js';
import { recordTemporaryTake } from './temporaryTake.js';

const readChunks = async (
  reader: ReadableStreamDefaultReader<AudioData>,
  parts: Float32Array[],
) => {
  for (
    let result = await reader.read();
    !result.done;
    result = await reader.read()
  ) {
    const samples = new Float32Array(result.value.numberOfFrames);
    result.value.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
    parts.push(samples);
    result.value.close();
  }
};

export type BrowserCaptureOptions = {
  seconds: number;
};

export type BrowserCapture = {
  sampleRate: number;
  label: string;
  settings: MediaTrackSettings;
  samples: string;
};

type TrackProcessorWindow = Window & {
  MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => {
    readable: ReadableStream<AudioData>;
  };
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
  const scope: TrackProcessorWindow = window;
  const TrackProcessor = scope.MediaStreamTrackProcessor;
  if (!TrackProcessor) {
    throw new Error('This browser has no MediaStreamTrackProcessor');
  }
  const reader = new TrackProcessor({ track }).readable.getReader();
  const parts: Float32Array[] = [];
  const reading = readChunks(reader, parts);
  console.info('[measure]', 'started', epochNow());
  await wait(options.seconds * 1000);
  await reader.cancel();
  await reading;
  for (const streamTrack of stream.getTracks()) {
    streamTrack.stop();
  }
  return {
    sampleRate: track.getSettings().sampleRate ?? engine.context.sampleRate,
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
