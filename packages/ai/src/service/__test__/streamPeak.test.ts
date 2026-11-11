import { describe, expect, it } from 'vitest';
import { readStreamPeak } from '../streamPeak.js';

const streamOf = (
  bytes: Uint8Array,
  cuts: number[],
): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      let from = 0;
      for (const to of [...cuts, bytes.length]) {
        controller.enqueue(bytes.slice(from, to));
        from = to;
      }
      controller.close();
    },
  });

describe('readStreamPeak', () => {
  const samples = Float32Array.from([0.25, -0.5, 1.75, -2.5, 0.125, 2]);
  const bytes = new Uint8Array(samples.buffer);

  it('finds the peak whatever bytes the chunks cut at', async () => {
    const cuts = [[], [4, 8], [1, 2, 3], [5], [7, 11, 13, 17], [23]];
    return Promise.all(
      cuts.map(async (at) => {
        expect(await readStreamPeak(streamOf(bytes, at))).toBe(2.5);
      }),
    );
  });

  it('reads silence as a zero peak', async () => {
    expect(await readStreamPeak(streamOf(new Uint8Array(0), []))).toBe(0);
  });
});
