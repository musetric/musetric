import { describe, expect, it } from 'vitest';
import { timedMicrophoneChannel } from '../protocol.cross.js';
import { createChunkPusher } from '../timedChunkPusher.cross.js';

const rate = 48000;
const chunkSize = 960;

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const pushChunks = async (startTimes: readonly number[]) => {
  const channel = new MessageChannel();
  const frames: number[] = [];
  timedMicrophoneChannel.inbound(channel.port2).bindHandlers({
    push: (message) => {
      frames.push(message.frame);
    },
  });
  const pusher = createChunkPusher({
    contextSampleRate: rate,
    outputClock: {
      read: () => ({ renderAhead: 0.02, clockOffset: 0 }),
    },
    port: timedMicrophoneChannel.outbound(channel.port1),
    isSettled: () => true,
  });
  for (const startMs of startTimes) {
    pusher.push({
      startMs,
      sampleRate: rate,
      samples: new Float32Array(chunkSize),
    });
  }
  await settle();
  channel.port1.close();
  channel.port2.close();
  return frames;
};

describe('createChunkPusher', () => {
  it('keeps chunks contiguous while their capture times jitter', async () => {
    const frames = await pushChunks([0, 21.4, 38.9, 61.2, 79.6]);
    expect(frames).toEqual([0, 960, 1920, 2880, 3840]);
  });

  it('leaves room for a chunk that never arrived', async () => {
    const frames = await pushChunks([0, 20, 60]);
    expect(frames).toEqual([0, 960, 2880]);
  });
});
