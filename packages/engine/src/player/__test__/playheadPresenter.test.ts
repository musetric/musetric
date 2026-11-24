import { describe, expect, it } from 'vitest';
import { type PlayheadLoop, type PlayheadValue } from '../playhead.cross.js';
import { createPlayheadPresenter } from '../playheadPresenter.cross.js';

const rate = 48000;
const screenMs = 1000 / 60;
const publishMs = 1000 / 240;

const wrap = (frameIndex: number, loop: PlayheadLoop | undefined) =>
  loop && frameIndex >= loop.toFrame
    ? loop.fromFrame +
      ((frameIndex - loop.fromFrame) % (loop.toFrame - loop.fromFrame))
    : frameIndex;

type Line = {
  shift?: number;
  revision?: number;
  loop?: PlayheadLoop;
};

const anchorAt = (epochMs: number, line: Line = {}): PlayheadValue => {
  const publishedMs = Math.floor(epochMs / publishMs) * publishMs;
  return {
    frameIndex: wrap(
      (publishedMs / 1000) * rate + (line.shift ?? 0),
      line.loop,
    ),
    revision: line.revision ?? 1,
    contextFrame: (publishedMs / 1000) * rate,
    startContextFrame: 0,
    rate: 1,
    clockOffset: 0,
    endFrame: Number.POSITIVE_INFINITY,
    loop: line.loop,
  };
};

const present = (frames: number, lineAt: (epochMs: number) => Line) => {
  const presenter = createPlayheadPresenter(rate);
  return Array.from({ length: frames }, (_, frame) => {
    const epochMs = 1000 + frame * screenMs;
    return presenter.present(anchorAt(epochMs, lineAt(epochMs)), epochMs);
  });
};

const stepsBack = (shown: readonly number[]) =>
  shown.filter((frame, index) => index > 0 && frame < shown[index - 1]).length;

describe('the playhead presenter', () => {
  it('follows a steady line to the frame', () => {
    const shown = present(60, () => ({}));
    shown.forEach((frame, index) => {
      expect(
        Math.abs(frame - ((1000 + index * screenMs) / 1000) * rate),
      ).toBeLessThanOrEqual(1);
    });
  });

  it('slows down instead of stepping back when the line moves 150 ms back', () => {
    const shown = present(240, (epochMs) => ({
      shift: epochMs > 1500 ? -0.15 * rate : 0,
    }));
    expect(stepsBack(shown)).toBe(0);
    const truth = ((1000 + 239 * screenMs) / 1000) * rate - 0.15 * rate;
    expect(Math.abs((shown.at(-1) ?? 0) - truth)).toBeLessThan(0.02 * rate);
  });

  it('jumps when the line moves by more than 0.2 s', () => {
    const shown = present(30, (epochMs) => ({
      shift: epochMs > 1200 ? -0.5 * rate : 0,
    }));
    expect(stepsBack(shown)).toBe(1);
  });

  it('jumps to a new revision at once', () => {
    const shown = present(30, (epochMs) =>
      epochMs > 1200 ? { shift: 10 * rate, revision: 2 } : {},
    );
    const before = shown.findLastIndex((frame) => frame < 5 * rate);
    expect(shown[before + 1] - shown[before]).toBeGreaterThan(9.9 * rate);
  });

  it('turns a loop without other steps back, slewing across the turn', () => {
    const loop = { fromFrame: 0, toFrame: 1.5 * rate };
    const shown = present(240, (epochMs) => ({
      loop,
      shift: epochMs > 1900 && epochMs < 2300 ? -0.05 * rate : 0,
    }));
    const turns = shown.filter(
      (frame, index) => index > 0 && shown[index - 1] - frame > rate / 2,
    ).length;
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(stepsBack(shown)).toBe(turns);
    expect(Math.max(...shown)).toBeLessThan(loop.toFrame);
  });

  it('holds a stopped line where it stands', () => {
    const presenter = createPlayheadPresenter(rate);
    const held: PlayheadValue = {
      ...anchorAt(1000),
      frameIndex: 12_345,
      rate: 0,
    };
    expect(presenter.present(held, 1000)).toBe(12_345);
    expect(presenter.present(held, 2000)).toBe(12_345);
  });
});
