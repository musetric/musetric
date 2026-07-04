import {
  floorMod,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
  windowStartForColumn,
} from './extConfig.js';

const markColumns = (columns: boolean[], from: number, count: number): void => {
  const start = Math.max(0, from);
  const end = Math.min(columns.length, from + count);
  for (let index = start; index < end; index += 1) {
    columns[index] = true;
  }
};

export const markShiftColumns = (
  columns: boolean[],
  baseColumn: number,
  previousBaseColumn: number,
): void => {
  const delta = baseColumn - previousBaseColumn;
  if (delta === 0) {
    return;
  }
  if (Math.abs(delta) >= columns.length) {
    markColumns(columns, 0, columns.length);
    return;
  }
  if (delta > 0) {
    markColumns(columns, columns.length - delta, delta);
    return;
  }
  markColumns(columns, 0, -delta);
};

export type ColumnGrid = {
  windowCount: number;
  columnStep: number;
};

type MarkInvalidatedColumnsOptions = {
  columns: boolean[];
  grid: ColumnGrid;
  baseColumn: number;
  analysisWindowSize: number;
  invalidations: readonly SpectrogramSampleRange[];
};

export const markInvalidatedColumns = (
  options: MarkInvalidatedColumnsOptions,
): void => {
  const { columns, grid, baseColumn, analysisWindowSize, invalidations } =
    options;
  if (analysisWindowSize <= 0) {
    return;
  }
  const { columnStep } = grid;
  for (const invalidation of invalidations) {
    if (invalidation.frameCount <= 0) {
      continue;
    }
    const invalidationStart = invalidation.frameIndex;
    const invalidationEnd = invalidation.frameIndex + invalidation.frameCount;
    const loColumn =
      Math.floor((invalidationStart - analysisWindowSize / 2) / columnStep) - 1;
    const hiColumn =
      Math.ceil((invalidationEnd + analysisWindowSize / 2) / columnStep) + 1;
    const from = Math.max(0, loColumn - baseColumn);
    const to = Math.min(columns.length, hiColumn - baseColumn + 1);
    for (let screenColumn = from; screenColumn < to; screenColumn += 1) {
      const windowStart = windowStartForColumn(
        grid,
        analysisWindowSize,
        baseColumn + screenColumn,
      );
      const windowEnd = windowStart + analysisWindowSize;
      if (windowStart < invalidationEnd && windowEnd > invalidationStart) {
        columns[screenColumn] = true;
      }
    }
  }
};

export const toColumnRanges = (
  grid: ColumnGrid,
  baseColumn: number,
  columns: readonly boolean[],
): SpectrogramColumnRange[] => {
  const ranges: SpectrogramColumnRange[] = [];
  let screenColumn = 0;
  while (screenColumn < columns.length) {
    while (screenColumn < columns.length && !columns[screenColumn]) {
      screenColumn += 1;
    }
    const screenBase = screenColumn;
    while (screenColumn < columns.length && columns[screenColumn]) {
      screenColumn += 1;
    }
    const columnCount = screenColumn - screenBase;
    if (columnCount > 0) {
      ranges.push({
        screenBase,
        slotOffset: floorMod(baseColumn + screenBase, grid.windowCount),
        columnCount,
      });
    }
  }
  return ranges;
};

const expandColumnRange = (
  grid: ColumnGrid,
  baseColumn: number,
  range: SpectrogramColumnRange,
  radius: number,
): SpectrogramColumnRange => {
  const screenBase = Math.max(0, range.screenBase - radius);
  const screenEnd = Math.min(
    grid.windowCount,
    range.screenBase + range.columnCount + radius,
  );
  return {
    screenBase,
    slotOffset: floorMod(baseColumn + screenBase, grid.windowCount),
    columnCount: screenEnd - screenBase,
  };
};

const mergeColumnRanges = (
  grid: ColumnGrid,
  baseColumn: number,
  ranges: readonly SpectrogramColumnRange[],
): SpectrogramColumnRange[] => {
  const merged: SpectrogramColumnRange[] = [];
  for (const range of ranges) {
    if (merged.length > 0) {
      const previous = merged[merged.length - 1];
      if (range.screenBase <= previous.screenBase + previous.columnCount) {
        const screenEnd = Math.max(
          previous.screenBase + previous.columnCount,
          range.screenBase + range.columnCount,
        );
        previous.columnCount = screenEnd - previous.screenBase;
        continue;
      }
    }
    merged.push({ ...range });
  }
  for (const range of merged) {
    range.slotOffset = floorMod(
      baseColumn + range.screenBase,
      grid.windowCount,
    );
  }
  return merged;
};

export const expandColumnRanges = (
  grid: ColumnGrid,
  baseColumn: number,
  ranges: readonly SpectrogramColumnRange[],
  radius: number,
): SpectrogramColumnRange[] =>
  mergeColumnRanges(
    grid,
    baseColumn,
    ranges.map((range) => expandColumnRange(grid, baseColumn, range, radius)),
  );
