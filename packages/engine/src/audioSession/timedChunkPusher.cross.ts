import { type timedMicrophoneChannel } from './protocol.cross.js';

const gapMs = 10;
const deliverySeconds = 0.25;

export type CapturedChunk = {
  startMs: number;
  sampleRate: number;
  samples: Float32Array;
};

export type TimedMicrophonePort = ReturnType<
  typeof timedMicrophoneChannel.outbound<MessagePort>
>;

type ClockReading = {
  renderAhead: number;
  clockOffset: number;
};

type CreateChunkPusherOptions = {
  contextSampleRate: number;
  outputClock: { read: () => ClockReading | undefined };
  port: TimedMicrophonePort;
  isSettled: () => boolean;
};

export const createChunkPusher = (options: CreateChunkPusherOptions) => {
  const { contextSampleRate, outputClock, port, isSettled } = options;
  let frame = 0;
  let endMs: number | undefined = undefined;
  let roundTripFrameCount: number | undefined = undefined;

  const push = (chunk: CapturedChunk) => {
    const { startMs, sampleRate, samples } = chunk;
    const frameCount = samples.length;
    if (endMs !== undefined && startMs - endMs > gapMs) {
      frame += Math.round(((startMs - endMs) * sampleRate) / 1000);
    }
    const reading = isSettled() ? outputClock.read() : undefined;
    if (reading) {
      roundTripFrameCount ??= Math.round(
        (reading.renderAhead + deliverySeconds) * contextSampleRate,
      );
      const heardTime =
        (performance.timeOrigin + startMs) / 1000 + reading.clockOffset;
      port.methods.push({
        frame,
        at: heardTime * contextSampleRate + roundTripFrameCount,
        sampleRate,
        samples,
      });
    }
    frame += frameCount;
    endMs = startMs + (frameCount / sampleRate) * 1000;
  };

  return { push, getRoundTripFrameCount: () => roundTripFrameCount };
};
