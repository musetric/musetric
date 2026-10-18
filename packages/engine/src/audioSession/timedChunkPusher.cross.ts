import { type timedMicrophoneChannel } from './protocol.cross.js';

const warmupMs = 300;
const headroomMs = 150;
const maximumDeliveryMs = 400;

export type CapturedChunk = {
  startMs: number;
  frame?: number;
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
  now: () => number;
};

export const createChunkPusher = (options: CreateChunkPusherOptions) => {
  const { contextSampleRate, outputClock, port, isSettled, now } = options;
  let frame = 0;
  let firstFrame: number | undefined = undefined;
  let endMs: number | undefined = undefined;
  let warmupEndMs: number | undefined = undefined;
  let deliveryMs = 0;
  let roundTripFrameCount: number | undefined = undefined;

  const push = (chunk: CapturedChunk) => {
    const { startMs, sampleRate, samples } = chunk;
    const frameCount = samples.length;
    const durationMs = (frameCount / sampleRate) * 1000;
    warmupEndMs ??= startMs + warmupMs;
    if (roundTripFrameCount === undefined) {
      deliveryMs = Math.max(deliveryMs, now() - startMs);
    }
    if (chunk.frame !== undefined) {
      firstFrame ??= chunk.frame;
      frame = chunk.frame - firstFrame;
    } else if (endMs !== undefined && startMs - endMs > durationMs / 2) {
      frame += Math.round(((startMs - endMs) * sampleRate) / 1000);
    }
    const reading =
      isSettled() && startMs >= warmupEndMs ? outputClock.read() : undefined;
    if (reading) {
      roundTripFrameCount ??= Math.round(
        (reading.renderAhead +
          Math.min(deliveryMs + headroomMs, maximumDeliveryMs) / 1000) *
          contextSampleRate,
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
    endMs = startMs + durationMs;
  };

  return { push, getRoundTripFrameCount: () => roundTripFrameCount };
};
