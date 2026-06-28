import { describe, expect, it } from 'vitest';
import {
  type ColumnGrid,
  expandColumnRanges,
  markInvalidatedColumns,
  markShiftColumns,
  toColumnRanges,
} from '../columnRanges.js';
import {
  type SpectrogramSampleRange,
  windowStartForColumn,
} from '../extConfig.js';

const grid = (windowCount: number, columnStep: number): ColumnGrid => ({
  windowCount,
  columnStep,
});

const falseColumns = (length: number): boolean[] =>
  new Array<boolean>(length).fill(false);

const trueIndices = (columns: readonly boolean[]): number[] =>
  columns.flatMap((value, index) => (value ? [index] : []));

describe('markShiftColumns', () => {
  it('marks nothing when the playhead does not move', () => {
    const columns = falseColumns(8);
    markShiftColumns(columns, 100, 100);
    expect(trueIndices(columns)).toEqual([]);
  });

  it('marks the leading edge when advancing', () => {
    const columns = falseColumns(8);
    markShiftColumns(columns, 103, 100);
    expect(trueIndices(columns)).toEqual([5, 6, 7]);
  });

  it('marks the trailing edge when rewinding', () => {
    const columns = falseColumns(8);
    markShiftColumns(columns, 98, 100);
    expect(trueIndices(columns)).toEqual([0, 1]);
  });

  it('marks every column once the move clears the screen', () => {
    const columns = falseColumns(4);
    markShiftColumns(columns, 100, 0);
    expect(trueIndices(columns)).toEqual([0, 1, 2, 3]);
  });
});

describe('toColumnRanges', () => {
  it('returns nothing for a clean screen', () => {
    expect(toColumnRanges(grid(8, 10), 0, falseColumns(8))).toEqual([]);
  });

  it('coalesces a contiguous run and resolves its ring slot', () => {
    const columns = falseColumns(8);
    columns[2] = true;
    columns[3] = true;
    columns[4] = true;
    expect(toColumnRanges(grid(8, 10), 5, columns)).toEqual([
      { screenBase: 2, slotOffset: (5 + 2) % 8, columnCount: 3 },
    ]);
  });

  it('keeps disjoint runs separate', () => {
    const columns = falseColumns(10);
    columns[1] = true;
    columns[6] = true;
    columns[7] = true;
    expect(toColumnRanges(grid(10, 10), 0, columns)).toEqual([
      { screenBase: 1, slotOffset: 1, columnCount: 1 },
      { screenBase: 6, slotOffset: 6, columnCount: 2 },
    ]);
  });
});

describe('expandColumnRanges', () => {
  it('grows each range by the radius and clamps to the screen', () => {
    const ranges = [{ screenBase: 5, slotOffset: 5, columnCount: 2 }];
    expect(expandColumnRanges(grid(20, 10), 0, ranges, 3)).toEqual([
      { screenBase: 2, slotOffset: 2, columnCount: 8 },
    ]);
  });

  it('merges ranges that overlap once expanded', () => {
    const ranges = [
      { screenBase: 2, slotOffset: 2, columnCount: 1 },
      { screenBase: 6, slotOffset: 6, columnCount: 1 },
    ];
    expect(expandColumnRanges(grid(20, 10), 0, ranges, 2)).toEqual([
      { screenBase: 0, slotOffset: 0, columnCount: 9 },
    ]);
  });
});

describe('markInvalidatedColumns', () => {
  const reference = (
    columnGrid: ColumnGrid,
    baseColumn: number,
    analysisWindowSize: number,
    invalidations: readonly SpectrogramSampleRange[],
  ): boolean[] => {
    const columns = falseColumns(columnGrid.windowCount);
    for (let screen = 0; screen < columnGrid.windowCount; screen += 1) {
      const windowStart = windowStartForColumn(
        columnGrid,
        analysisWindowSize,
        baseColumn + screen,
      );
      const windowEnd = windowStart + analysisWindowSize;
      for (const invalidation of invalidations) {
        if (invalidation.frameCount <= 0) {
          continue;
        }
        const start = invalidation.frameIndex;
        const end = invalidation.frameIndex + invalidation.frameCount;
        if (windowStart < end && windowEnd > start) {
          columns[screen] = true;
          break;
        }
      }
    }
    return columns;
  };

  it('does nothing without a window or a range', () => {
    const columns = falseColumns(8);
    markInvalidatedColumns(columns, grid(8, 10), 0, 0, [
      { frameIndex: 0, frameCount: 100 },
    ]);
    expect(trueIndices(columns)).toEqual([]);
    markInvalidatedColumns(columns, grid(8, 10), 0, 64, []);
    expect(trueIndices(columns)).toEqual([]);
  });

  it('matches the brute-force scan across many shapes', () => {
    const windowCount = 64;
    const cases: {
      columnStep: number;
      baseColumn: number;
      windowSize: number;
      invalidations: SpectrogramSampleRange[];
    }[] = [];
    for (let seed = 0; seed < 200; seed += 1) {
      const columnStep = 4 + (seed % 17);
      const baseColumn = (seed * 31) % 500;
      const windowSize = 16 << (seed % 4);
      const frameIndex = baseColumn * columnStep + ((seed * 13) % 4000) - 1000;
      const frameCount = 1 + ((seed * 7) % 900);
      cases.push({
        columnStep,
        baseColumn,
        windowSize,
        invalidations: [{ frameIndex, frameCount }],
      });
    }
    for (const item of cases) {
      const columnGrid = grid(windowCount, item.columnStep);
      const expected = reference(
        columnGrid,
        item.baseColumn,
        item.windowSize,
        item.invalidations,
      );
      const actual = falseColumns(windowCount);
      markInvalidatedColumns(
        actual,
        columnGrid,
        item.baseColumn,
        item.windowSize,
        item.invalidations,
      );
      expect(trueIndices(actual)).toEqual(trueIndices(expected));
    }
  });

  it('handles several disjoint invalidations at once', () => {
    const columnGrid = grid(64, 8);
    const invalidations: SpectrogramSampleRange[] = [
      { frameIndex: 80, frameCount: 16 },
      { frameIndex: 400, frameCount: 16 },
    ];
    const actual = falseColumns(64);
    markInvalidatedColumns(actual, columnGrid, 0, 32, invalidations);
    const expected = reference(columnGrid, 0, 32, invalidations);
    expect(trueIndices(actual)).toEqual(trueIndices(expected));
    const indices = trueIndices(actual);
    expect(indices.length).toBeGreaterThan(0);
    expect(toColumnRanges(columnGrid, 0, actual)).toHaveLength(2);
  });
});
