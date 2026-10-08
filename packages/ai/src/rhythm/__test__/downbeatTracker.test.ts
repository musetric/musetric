import { describe, expect, it } from 'vitest';
import { trackBeatTimes } from '../downbeatTracker.js';

const fps = 50;
const frameCount = 1500;
const gridStep = 25;
const gapStart = 500;
const gapEnd = 800;
const strayPeaks = [512, 547, 590, 618, 671, 702, 744];

const gridFrames = (from: number, to: number) =>
  Array.from(
    { length: Math.ceil((to - from) / gridStep) },
    (_, index) => from + index * gridStep,
  );

const createLogits = () => {
  const beat = new Float32Array(frameCount).fill(-6);
  const downbeat = new Float32Array(frameCount).fill(-6);
  gridFrames(10, frameCount).forEach((frame, index) => {
    if (frame >= gapStart && frame < gapEnd) {
      return;
    }
    beat[frame] = 6;
    if (index % 4 === 0) {
      downbeat[frame] = 6;
    }
  });
  strayPeaks.forEach((frame) => {
    beat[frame] = 1;
  });
  return { beat, downbeat };
};

const seconds = (frames: number[]) => frames.map((frame) => frame / fps);

describe('downbeat tracker', () => {
  it('matches madmom on a passage without beats but with stray peaks', () => {
    const { beat, downbeat } = createLogits();
    const gap = [512, 537, 563, 590, 618, 644, 671, 698, 721, 744, 765, 787];
    expect(trackBeatTimes(beat, downbeat, fps)).toEqual({
      beats: seconds([
        ...gridFrames(10, gapStart),
        ...gap,
        ...gridFrames(810, frameCount),
      ]),
      downbeats: seconds([
        10, 110, 210, 310, 410, 512, 618, 721, 810, 910, 1010, 1110, 1210, 1310,
        1410,
      ]),
    });
  });

  it('returns no beats where the network finds none', () => {
    const silence = new Float32Array(frameCount).fill(-6);
    expect(trackBeatTimes(silence, silence, fps)).toEqual({
      beats: [],
      downbeats: [],
    });
  });
});
