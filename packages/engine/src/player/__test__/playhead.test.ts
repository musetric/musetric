import { describe, expect, it } from 'vitest';
import {
  createPlayhead,
  extrapolatePlayhead,
  type PlayheadValue,
} from '../playhead.cross.js';
import { blockSize, createHarness, rate, settle } from './player.fixtures.js';

const outputLatency = 4800;

type Segment = {
  blocks: number;
  rate: number;
};

const renderedFrame = (
  startFrame: number,
  segments: readonly Segment[],
  contextFrame: number,
): number => {
  let frame = startFrame;
  let context = 0;
  for (const segment of segments) {
    const length = segment.blocks * blockSize;
    const step = Math.min(length, Math.max(0, contextFrame - context));
    frame += step * segment.rate;
    context += length;
  }
  return frame;
};

const createPlayer = async () => {
  const playheadChannel = new MessageChannel();
  const harness = await createHarness([], [playheadChannel.port1]);
  const playhead = createPlayhead(playheadChannel.port2, rate);
  const silence = new Float32Array(blockSize);
  const run = async (blocks: number): Promise<PlayheadValue> => {
    for (let block = 0; block < blocks; block += 1) {
      harness.process(silence);
    }
    await settle();
    return playhead.read();
  };
  return { harness, run };
};

describe('player playhead', () => {
  it('reports the song frame heard at the speaker across a tempo change', async () => {
    const { harness, run } = await createPlayer();
    const startFrame = rate;
    harness.player.methods.seek({ frameIndex: startFrame, revision: 1 });
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: outputLatency,
      inputLatencyFrameCount: 0,
    });
    await settle();
    const before = await run(10);
    expect(before.frameIndex).toBe(startFrame);
    expect(before.rate).toBe(1);
    expect(before.startContextFrame).toBe(0);

    const steady = await run(100);
    expect(steady.frameIndex).toBe(
      renderedFrame(
        startFrame,
        [{ blocks: 110, rate: 1 }],
        steady.contextFrame,
      ),
    );

    harness.player.methods.setTempoRatio({ tempoRatio: 0.5 });
    await settle();
    const segments = [
      { blocks: 110, rate: 1 },
      { blocks: 1000, rate: 0.5 },
    ];
    for (const blocks of [5, 10, 20]) {
      const value = await run(blocks);
      expect(value.contextFrame).toBeGreaterThan(
        110 * blockSize - outputLatency,
      );
      expect(value.frameIndex).toBe(
        renderedFrame(startFrame, segments, value.contextFrame),
      );
    }
    const after = await run(40);
    expect(after.contextFrame).toBeGreaterThan(110 * blockSize);
    expect(after.rate).toBe(0.5);
    expect(after.frameIndex).toBe(
      renderedFrame(startFrame, segments, after.contextFrame),
    );
  });

  it('wraps the heard frame at the loop end an output latency after the render', async () => {
    const { harness, run } = await createPlayer();
    const range = { fromFrame: rate, toFrame: rate + 50 * blockSize };
    harness.player.methods.setRange({ range, repeat: 'cycle' });
    harness.player.methods.seek({ frameIndex: range.fromFrame, revision: 1 });
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: outputLatency,
      inputLatencyFrameCount: 0,
    });
    await settle();
    const length = range.toFrame - range.fromFrame;
    for (const blocks of [40, 20, 20, 30]) {
      const value = await run(blocks);
      const expected = range.fromFrame + (value.contextFrame % length);
      expect(value.frameIndex).toBe(expected);
      expect(value.loop).toEqual(range);
    }
  });
});

describe('playhead extrapolation', () => {
  const clockOffset = -100;
  const value: PlayheadValue = {
    frameIndex: 10_000,
    revision: 1,
    contextFrame: 2 * rate,
    startContextFrame: rate,
    rate: 0.5,
    clockOffset,
    endFrame: 1_000_000,
  };
  const epochAt = (heardContextFrame: number) =>
    (heardContextFrame / rate - clockOffset) * 1000;

  it('moves on from the reported frame at the heard rate', () => {
    expect(extrapolatePlayhead(value, epochAt(2 * rate + 4800), rate)).toBe(
      10_000 + 2400,
    );
    expect(extrapolatePlayhead(value, epochAt(2 * rate - 4800), rate)).toBe(
      10_000 - 2400,
    );
  });

  it('holds the start until it is heard', () => {
    const held = { ...value, contextFrame: rate, frameIndex: 5000 };
    expect(extrapolatePlayhead(held, epochAt(rate - 4800), rate)).toBe(5000);
    expect(extrapolatePlayhead(held, epochAt(rate + 480), rate)).toBe(5240);
  });

  it('wraps at the loop end and stops at the end frame', () => {
    const looped = { ...value, loop: { fromFrame: 9000, toFrame: 10_100 } };
    expect(extrapolatePlayhead(looped, epochAt(2 * rate + 480), rate)).toBe(
      9000 + 140,
    );
    const ending = { ...value, endFrame: 10_100 };
    expect(extrapolatePlayhead(ending, epochAt(2 * rate + 4800), rate)).toBe(
      10_100,
    );
  });

  it('does not move without a clock or while held', () => {
    const now = epochAt(2 * rate + 4800);
    expect(
      extrapolatePlayhead({ ...value, clockOffset: undefined }, now, rate),
    ).toBe(10_000);
    expect(extrapolatePlayhead({ ...value, rate: 0 }, now, rate)).toBe(10_000);
  });

  it('extrapolates at most a quarter of a second', () => {
    expect(extrapolatePlayhead(value, epochAt(3 * rate), rate)).toBe(
      10_000 + 0.25 * rate * 0.5,
    );
  });
});
