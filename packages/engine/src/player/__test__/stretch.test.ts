import { describe, expect, it } from 'vitest';
import {
  blockSize,
  burstCenters,
  burstLength,
  burstSeconds,
  createHarness,
  rate,
  settle,
  timingTolerance,
} from './player.fixtures.js';

const changeSecond = 2.75;

const playAcrossTempoChange = async (before: number, after: number) => {
  const harness = await createHarness([]);
  harness.player.methods.setTempoRatio({ tempoRatio: before });
  harness.player.methods.setTransposeSemitones({ transposeSemitones: 2 });
  harness.player.methods.seek({ frameIndex: 0, revision: 1 });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: 0,
    inputLatencyFrameCount: 0,
  });
  await settle();
  const changeBlock = Math.round((changeSecond * rate) / before / blockSize);
  const lastSecond = burstSeconds[burstSeconds.length - 1] + 0.5;
  const afterBlocks = Math.ceil(
    ((lastSecond - changeSecond) * rate) / after / blockSize,
  );
  const played: number[] = [];
  for (let block = 0; block < changeBlock; block += 1) {
    played.push(...harness.process(new Float32Array(blockSize)));
  }
  harness.player.methods.setTempoRatio({ tempoRatio: after });
  await settle();
  for (let block = 0; block < afterBlocks; block += 1) {
    played.push(...harness.process(new Float32Array(blockSize)));
  }
  const changeFrame = changeBlock * blockSize;
  const changeSongFrame = changeFrame * before;
  const expected = burstSeconds.map((second) => {
    const songFrame = second * rate + burstLength / 2;
    return songFrame < changeSongFrame
      ? songFrame / before
      : changeFrame + (songFrame - changeSongFrame) / after;
  });
  return { heard: burstCenters(Float32Array.from(played)), expected };
};

describe('player stretch', () => {
  it.each([
    [0.8, 1.25],
    [1.25, 0.8],
    [0.75, 0.5],
  ])(
    'keeps the song in step when the tempo moves from %f to %f',
    async (before, after) => {
      const { heard, expected } = await playAcrossTempoChange(before, after);
      expect(heard).toHaveLength(expected.length);
      heard.forEach((center, index) => {
        expect(Math.abs(center - expected[index])).toBeLessThan(
          timingTolerance,
        );
      });
    },
  );
});
