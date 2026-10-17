import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  timedMicrophoneChannel,
  timedMicrophoneProcessorName,
} from './protocol.cross.js';
import timedMicrophoneWorkletUrl from './timedMicrophone.worklet.ts?worker&url';

const readyTimeoutMs = 3000;
const gapMs = 10;
const deliverySeconds = 0.25;

type TrackProcessor = {
  readable: ReadableStream<AudioData>;
};

type TrackProcessorConstructor = new (init: {
  track: MediaStreamTrack;
}) => TrackProcessor;

type TrackProcessorWindow = Window & {
  MediaStreamTrackProcessor?: TrackProcessorConstructor;
};

const readTrackProcessor = (): TrackProcessorConstructor | undefined => {
  const target: TrackProcessorWindow = window;
  return target.MediaStreamTrackProcessor;
};

const readMono = (data: AudioData) => {
  const samples = new Float32Array(data.numberOfFrames);
  if (data.numberOfChannels === 1) {
    data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
    return samples;
  }
  const plane = new Float32Array(data.numberOfFrames);
  for (
    let planeIndex = 0;
    planeIndex < data.numberOfChannels;
    planeIndex += 1
  ) {
    data.copyTo(plane, { planeIndex, format: 'f32-planar' });
    for (let index = 0; index < plane.length; index += 1) {
      samples[index] += plane[index] / data.numberOfChannels;
    }
  }
  return samples;
};

export type CapturedChunk = {
  startMs: number;
  sampleRate: number;
  samples: Float32Array;
};

const pumpChunks = async (
  reader: ReadableStreamDefaultReader<AudioData>,
  push: (chunk: CapturedChunk) => void,
) => {
  for (
    let result = await reader.read();
    !result.done;
    result = await reader.read()
  ) {
    const data = result.value;
    push({
      startMs: data.timestamp / 1000,
      sampleRate: data.sampleRate,
      samples: readMono(data),
    });
    data.close();
  }
};

export type CapturedChunkSource = (
  push: (chunk: CapturedChunk) => void,
) => () => void;

export const readTrackChunks = (
  track: MediaStreamTrack,
): CapturedChunkSource | undefined => {
  const TrackProcessorClass = readTrackProcessor();
  if (!TrackProcessorClass) {
    return undefined;
  }
  return (push) => {
    const reader = new TrackProcessorClass({ track }).readable.getReader();
    void pumpChunks(reader, push).catch((error: unknown) => {
      console.error('Failed to read the microphone', error);
    });
    return () => {
      void reader.cancel();
    };
  };
};

type TimedMicrophonePort = ReturnType<
  typeof timedMicrophoneChannel.outbound<MessagePort>
>;

type CreateChunkPusherOptions = {
  context: AudioContext;
  outputClock: EngineOutputClock;
  port: TimedMicrophonePort;
  isSettled: () => boolean;
};

const createChunkPusher = (options: CreateChunkPusherOptions) => {
  const { context, outputClock, port, isSettled } = options;
  let frame = 0;
  let endMs: number | undefined = undefined;
  let roundTripFrameCount: number | undefined = undefined;

  const push = (chunk: CapturedChunk) => {
    const { startMs, sampleRate, samples } = chunk;
    if (endMs !== undefined && startMs - endMs > gapMs) {
      frame += Math.round(((startMs - endMs) * sampleRate) / 1000);
    }
    const reading = isSettled() ? outputClock.read() : undefined;
    if (reading) {
      roundTripFrameCount ??= Math.round(
        (reading.renderAhead + deliverySeconds) * context.sampleRate,
      );
      const heardTime =
        (performance.timeOrigin + startMs) / 1000 + reading.clockOffset;
      port.methods.push({
        frame,
        at: heardTime * context.sampleRate + roundTripFrameCount,
        sampleRate,
        samples,
      });
    }
    frame += samples.length;
    endMs = startMs + (samples.length / sampleRate) * 1000;
  };

  return { push, getRoundTripFrameCount: () => roundTripFrameCount };
};

const waitForReady = async (port: TimedMicrophonePort) =>
  new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      resolve(false);
    }, readyTimeoutMs);
    port.bindHandlers({
      ready: () => {
        window.clearTimeout(timeout);
        resolve(true);
      },
    });
  });

export type TimedMicrophoneSource = {
  node: AudioNode;
  roundTripLatency: number;
  close: () => void;
};

export type TimedMicrophones = {
  open: (source: CapturedChunkSource) => Promise<TimedMicrophoneSource>;
};

export const createTimedMicrophones = (
  context: AudioContext,
  outputClock: EngineOutputClock,
): TimedMicrophones => {
  let modulePromise: Promise<void> | undefined = undefined;

  const loadModule = async () => {
    modulePromise ??= context.audioWorklet
      .addModule(timedMicrophoneWorkletUrl)
      .catch((error: unknown) => {
        modulePromise = undefined;
        throw error;
      });
    await modulePromise;
  };

  return {
    open: async (source) => {
      await loadModule();
      const node = new AudioWorkletNode(context, timedMicrophoneProcessorName, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const keepAlive = context.createGain();
      keepAlive.gain.value = 0;
      node.connect(keepAlive);
      keepAlive.connect(context.destination);
      const port = timedMicrophoneChannel.outbound(node.port);
      const ready = waitForReady(port);
      let settled = false;
      void outputClock.whenSettled().then(() => {
        settled = true;
      });
      const pusher = createChunkPusher({
        context,
        outputClock,
        port,
        isSettled: () => settled,
      });
      const unsubscribe = source(pusher.push);
      const close = () => {
        unsubscribe();
        node.disconnect();
        keepAlive.disconnect();
        node.port.close();
      };

      const roundTripFrameCount = (await ready)
        ? pusher.getRoundTripFrameCount()
        : undefined;
      if (roundTripFrameCount === undefined) {
        close();
        throw new Error('The microphone delivered no timed audio');
      }
      return {
        node,
        roundTripLatency: roundTripFrameCount / context.sampleRate,
        close,
      };
    },
  };
};
