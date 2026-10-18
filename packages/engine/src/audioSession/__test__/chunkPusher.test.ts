import { describe, expect, it } from 'vitest';
import { timedMicrophoneChannel } from '../protocol.cross.js';
import { createChunkPusher } from '../timedChunkPusher.cross.js';

const rate = 48000;
const chunkSize = 960;
const chunkMs = 20;
const renderAhead = 0.02;
const warmup = Array.from({ length: 15 }, (_, index) => index * chunkMs);

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

type PushOptions = {
  arrivalMs?: number;
  size?: number;
  frames?: readonly number[];
};

const pushChunks = async (
  startTimes: readonly number[],
  options: PushOptions = {},
) => {
  const { arrivalMs = 1, size = chunkSize, frames: captureFrames } = options;
  const channel = new MessageChannel();
  const frames: number[] = [];
  timedMicrophoneChannel.inbound(channel.port2).bindHandlers({
    push: (message) => {
      frames.push(message.frame);
    },
  });
  let nowMs = 0;
  const pusher = createChunkPusher({
    contextSampleRate: rate,
    outputClock: {
      read: () => ({ renderAhead, clockOffset: 0 }),
    },
    port: timedMicrophoneChannel.outbound(channel.port1),
    isSettled: () => true,
    now: () => nowMs,
  });
  for (const [index, startMs] of startTimes.entries()) {
    nowMs = startMs + (size / rate) * 1000 + arrivalMs;
    pusher.push({
      startMs,
      frame: captureFrames?.[index],
      sampleRate: rate,
      samples: new Float32Array(size),
    });
  }
  await settle();
  channel.port1.close();
  channel.port2.close();
  return { frames, roundTrip: pusher.getRoundTripFrameCount() };
};

describe('createChunkPusher', () => {
  it('keeps chunks contiguous while their capture times jitter', async () => {
    const { frames } = await pushChunks([
      ...warmup,
      300,
      321.4,
      338.9,
      361.2,
      379.6,
    ]);
    expect(frames).toEqual([14400, 15360, 16320, 17280, 18240]);
  });

  it('leaves room for a chunk that never arrived', async () => {
    const { frames } = await pushChunks([...warmup, 300, 320, 360]);
    expect(frames).toEqual([14400, 15360, 17280]);
  });

  it('leaves room for a short chunk that never arrived', async () => {
    const shortWarmup = Array.from({ length: 30 }, (_, index) => index * 10);
    const { frames } = await pushChunks([...shortWarmup, 300, 310, 330], {
      size: 480,
    });
    expect(frames).toEqual([14400, 14880, 15840]);
  });

  it('counts frames from the capture when it reports them', async () => {
    const startTimes = [...warmup, 300, 332, 340, 380];
    const { frames } = await pushChunks(startTimes, {
      frames: [
        ...warmup.map((_, index) => 1000 + index * chunkSize),
        1000 + 15 * chunkSize,
        1000 + 16 * chunkSize,
        1000 + 17 * chunkSize,
        1000 + 19 * chunkSize,
      ],
    });
    expect(frames).toEqual([14400, 15360, 16320, 18240]);
  });

  it('sets the delivery margin from how late chunks arrived', async () => {
    const { roundTrip } = await pushChunks([...warmup, 300], { arrivalMs: 3 });
    expect(roundTrip).toBe(Math.round((renderAhead + 0.173) * rate));
  });

  it('caps the delivery margin for chunks that arrive very late', async () => {
    const { roundTrip } = await pushChunks([...warmup, 300], {
      arrivalMs: 400,
    });
    expect(roundTrip).toBe(Math.round((renderAhead + 0.4) * rate));
  });
});
