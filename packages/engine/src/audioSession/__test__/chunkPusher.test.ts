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

const pushChunks = async (startTimes: readonly number[], arrivalMs = 1) => {
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
  for (const startMs of startTimes) {
    nowMs = startMs + chunkMs + arrivalMs;
    pusher.push({
      startMs,
      sampleRate: rate,
      samples: new Float32Array(chunkSize),
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

  it('sets the delivery margin from how late chunks arrived', async () => {
    const { roundTrip } = await pushChunks([...warmup, 300], 3);
    expect(roundTrip).toBe(Math.round((renderAhead + 0.073) * rate));
  });

  it('caps the delivery margin for chunks that arrive very late', async () => {
    const { roundTrip } = await pushChunks([...warmup, 300], 400);
    expect(roundTrip).toBe(Math.round((renderAhead + 0.25) * rate));
  });
});
