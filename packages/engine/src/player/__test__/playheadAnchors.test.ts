import { describe, expect, it } from 'vitest';
import {
  blockSize,
  createHarness,
  fadeQuanta,
  rate,
  settle,
} from './player.fixtures.js';

const quantaOfSeconds = (seconds: number) =>
  Math.round((seconds * rate) / blockSize);

const createCountedPlayer = async () => {
  const channel = new MessageChannel();
  const harness = await createHarness([], [channel.port1]);
  let published = 0;
  channel.port2.onmessage = () => {
    published += 1;
  };
  const silence = new Float32Array(blockSize);
  const run = async (quanta: number) => {
    for (let quantum = 0; quantum < quanta; quantum += 1) {
      harness.process(silence);
      if (quantum % 8 === 7) {
        await settle();
      }
    }
    await settle();
  };
  const count = async (body: () => Promise<void>) => {
    const before = published;
    await body();
    return published - before;
  };
  return { harness, run, count };
};

describe('the anchors of the playhead', () => {
  it('pulses about 15 times a second while the line holds', async () => {
    const { harness, run, count } = await createCountedPlayer();
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: 4800,
      inputLatencyFrameCount: 0,
    });
    await run(quantaOfSeconds(0.5));
    const second = await count(async () => run(quantaOfSeconds(1)));
    expect(second).toBeGreaterThanOrEqual(14);
    expect(second).toBeLessThanOrEqual(17);
  });

  it('publishes a new anchor at once on a change of tempo and where a seek lands', async () => {
    const { harness, run, count } = await createCountedPlayer();
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: 0,
      inputLatencyFrameCount: 0,
    });
    await run(quantaOfSeconds(0.5));
    harness.player.methods.setTempoRatio({ tempoRatio: 0.5 });
    await settle();
    expect(await count(async () => run(2))).toBeGreaterThanOrEqual(1);
    harness.player.methods.seek({ frameIndex: 3 * rate, revision: 2 });
    await settle();
    await run(fadeQuanta);
    expect(await count(async () => run(1))).toBeGreaterThanOrEqual(1);
  });

  it('publishes nothing while the song stands still', async () => {
    const { run, count } = await createCountedPlayer();
    await run(10);
    expect(await count(async () => run(quantaOfSeconds(1)))).toBe(0);
  });
});
