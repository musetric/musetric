import { describe, expect, it } from 'vitest';
import { consecutiveProbeBpms, summarizeRhythm } from '../rhythmSummary.js';

const fps = 50;
const duration = 180;

const onFrames = (time: number) => Math.round(time * fps) / fps;

type GridBeat = {
  time: number;
  index: number;
};

const createGrid = (beatSeconds: (time: number) => number): GridBeat[] => {
  const grid: GridBeat[] = [];
  let time = 0.5;
  while (time < duration) {
    grid.push({ time: onFrames(time), index: grid.length });
    time += beatSeconds(time);
  }
  return grid;
};

const summarizeGrid = (
  grid: GridBeat[],
  isDownbeat = (index: number) => index % 8 === 0,
) => {
  const beats = grid.map((beat) => beat.time);
  const downbeats = grid
    .filter((beat) => isDownbeat(beat.index))
    .map((beat) => beat.time);
  const result = summarizeRhythm(
    beats,
    downbeats,
    consecutiveProbeBpms(beats, duration),
  );
  const everyOther = grid
    .filter((beat) => beat.index % 2 === 0)
    .map((beat) => beat.time);
  return { downbeats, everyOther, result };
};

describe('rhythm summary', () => {
  it.each([100, 105, 108, 110, 112, 120, 128, 140])(
    'finds the tempo of a steady %d BPM grid',
    (bpm) => {
      const { result } = summarizeGrid(createGrid(() => 60 / bpm));
      expect(result.bpm).toBeCloseTo(bpm, 1);
    },
  );

  it('keeps the tempo across a pause and a late beat', () => {
    const grid = createGrid(() => 60 / 110).filter(
      (beat) => beat.time < 60 || beat.time > 65,
    );
    grid[200].time += 0.1;
    const { result } = summarizeGrid(grid);
    expect(result.bpm).toBeCloseTo(110, 1);
  });

  it('keeps the tempo when the tracker adds a beat inside an interval', () => {
    const grid = createGrid(() => 60 / 110);
    const added = grid.flatMap((beat, index) =>
      index % 16 === 5
        ? [beat, { time: onFrames(beat.time + 0.35), index: -1 }]
        : [beat],
    );
    const { result } = summarizeGrid(added);
    expect(result.bpm).toBeCloseTo(110, 1);
  });

  it.each([170, 176, 180, 184, 190, 200])(
    'halves a steady %d BPM grid on every other beat',
    (bpm) => {
      const { downbeats, everyOther, result } = summarizeGrid(
        createGrid(() => 60 / bpm),
      );
      expect(result.beats).toEqual(everyOther);
      expect(result.downbeats).toEqual(downbeats);
      expect(result.bpm).toBeCloseTo(bpm / 2, 1);
    },
  );

  it('keeps the downbeats across a pause in the beats', () => {
    const grid = createGrid(() => 60 / 184).filter(
      (beat) => beat.time < 60 || beat.time > 65,
    );
    const { downbeats, everyOther, result } = summarizeGrid(grid);
    expect(result.beats).toEqual(everyOther);
    expect(result.downbeats).toEqual(downbeats);
  });

  it('keeps every downbeat after a bar of five beats', () => {
    const grid = createGrid(() => 60 / 184);
    const { downbeats, result } = summarizeGrid(grid, (index) =>
      index < 25 ? index % 4 === 0 : (index - 25) % 4 === 0,
    );
    expect(result.downbeats).toEqual(downbeats);
    expect(result.beats).toEqual(
      grid
        .filter(
          (beat) => (beat.index < 25 ? beat.index : beat.index - 25) % 2 === 0,
        )
        .map((beat) => beat.time),
    );
  });

  it('halves bars of three beats on every other beat', () => {
    const { everyOther, result } = summarizeGrid(
      createGrid(() => 60 / 184),
      (index) => index % 3 === 0,
    );
    expect(result.beats).toEqual(everyOther);
  });

  it('keeps the downbeats of a drifting tempo', () => {
    const { downbeats, everyOther, result } = summarizeGrid(
      createGrid((time) => 60 / (184 * (1 + 0.03 * Math.sin(time / 20)))),
    );
    expect(result.beats).toEqual(everyOther);
    expect(result.downbeats).toEqual(downbeats);
  });

  it('clicks the shown tempo through a half-time section', () => {
    const grid = createGrid(() => 60 / 120);
    const inSection = (index: number) => index >= 120 && index < 180;
    const tracked = grid.filter(
      (beat) => !inSection(beat.index) || beat.index % 2 === 0,
    );
    const { result } = summarizeGrid(
      tracked,
      (index) => index % (inSection(index) ? 8 : 4) === 0,
    );
    expect(result.bpm).toBeCloseTo(120, 1);
    expect(result.beats).toHaveLength(grid.length);
    result.beats.forEach((time, index) => {
      expect(Math.abs(time - grid[index].time)).toBeLessThan(0.011);
    });
    expect(result.downbeats).toHaveLength(
      grid.filter((beat) => beat.index % 4 === 0).length,
    );
  });

  it('keeps every other beat of a double-time section', () => {
    const grid = createGrid(() => 60 / 100);
    const inSection = (index: number) => index >= 100 && index < 150;
    const tracked = grid.flatMap((beat) =>
      inSection(beat.index)
        ? [beat, { time: onFrames(beat.time + 0.3), index: -1 }]
        : [beat],
    );
    const { result } = summarizeGrid(
      tracked,
      (index) => index % (inSection(index) ? 2 : 4) === 0,
    );
    expect(result.bpm).toBeCloseTo(100, 1);
    expect(result.beats).toEqual(grid.map((beat) => beat.time));
    expect(result.downbeats).toEqual(
      grid.filter((beat) => beat.index % 4 === 0).map((beat) => beat.time),
    );
  });
});
