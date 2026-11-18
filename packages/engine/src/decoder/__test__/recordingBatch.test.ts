import { describe, expect, it } from 'vitest';
import { type LiveTakeChunk } from '../../player/protocol.cross.js';
import { createRecordingBatch } from '../recordingBatch.worker.js';
import { readRecordingPacket } from '../recordingStream.worker.js';

const chunk = (
  startFrame: number,
  offset: number,
  length: number,
): LiveTakeChunk => ({
  startFrame,
  offset,
  samples: Float32Array.from({ length }, (_, index) => offset + index),
});

const collect = (packetFrames: number) => {
  const sent: LiveTakeChunk[] = [];
  const batch = createRecordingBatch({
    sampleRate: packetFrames * 20,
    realtime: {
      sendBinary: (packet) => {
        sent.push(readRecordingPacket(packet));
      },
    },
  });
  return { batch, sent };
};

const describeSent = (sent: readonly LiveTakeChunk[]) =>
  sent.map((packet) => ({
    startFrame: packet.startFrame,
    offset: packet.offset,
    samples: Array.from(packet.samples),
  }));

describe('recording batch', () => {
  it('sends contiguous chunks as one packet once it holds the frames', () => {
    const { batch, sent } = collect(6);
    batch.push(chunk(100, 0, 4));
    expect(sent).toHaveLength(0);
    batch.push(chunk(100, 4, 4));
    batch.push(chunk(100, 8, 4));
    batch.flush();
    expect(describeSent(sent)).toEqual([
      { startFrame: 100, offset: 0, samples: [0, 1, 2, 3, 4, 5, 6, 7] },
      { startFrame: 100, offset: 8, samples: [8, 9, 10, 11] },
    ]);
  });

  it('sends what it holds before a new run or a gap', () => {
    const { batch, sent } = collect(100);
    batch.push(chunk(100, 0, 2));
    batch.push(chunk(300, 0, 2));
    batch.push(chunk(300, 5, 2));
    batch.flush();
    expect(describeSent(sent)).toEqual([
      { startFrame: 100, offset: 0, samples: [0, 1] },
      { startFrame: 300, offset: 0, samples: [0, 1] },
      { startFrame: 300, offset: 5, samples: [5, 6] },
    ]);
  });

  it('sends nothing when it holds nothing', () => {
    const { batch, sent } = collect(4);
    batch.flush();
    batch.push(chunk(0, 0, 4));
    batch.flush();
    expect(sent).toHaveLength(1);
  });
});
