type RangeCopy = {
  source: Float32Array;
  sourceStart: number;
  target: Float32Array;
  targetOffset: number;
  count: number;
};

const copyRange = (copy: RangeCopy): void => {
  const { source, sourceStart, target, targetOffset, count } = copy;
  const from = Math.max(0, sourceStart);
  const to = Math.min(source.length, sourceStart + count);
  if (to > from) {
    target.set(source.subarray(from, to), targetOffset + from - sourceStart);
  }
};

export type SpectrogramSource = {
  mapped: boolean;
  songLength: number;
  length: number;
  stretch: number;
  reach: number;
  position: (songFrame: number) => number;
  read: (
    target: Float32Array,
    targetOffset: number,
    from: number,
    count: number,
  ) => void;
};

export const createPlainSource = (
  samples: Float32Array,
): SpectrogramSource => ({
  mapped: false,
  songLength: samples.length,
  length: samples.length,
  stretch: 1,
  reach: 1,
  position: (songFrame) => songFrame,
  read: (target, targetOffset, from, count) => {
    target.fill(0, targetOffset, targetOffset + count);
    copyRange({
      source: samples,
      sourceStart: from,
      target,
      targetOffset,
      count,
    });
  },
});

const plainSources = new WeakMap<Float32Array, SpectrogramSource>();

export type SpectrogramSourceInput = Float32Array | SpectrogramSource;

export const toSpectrogramSource = (
  input: SpectrogramSourceInput,
): SpectrogramSource => {
  if (!(input instanceof Float32Array)) {
    return input;
  }
  const cached = plainSources.get(input);
  if (cached) {
    return cached;
  }
  const source = createPlainSource(input);
  plainSources.set(input, source);
  return source;
};

export type SpectrogramSourcePiece = {
  songStartFrame: number;
  songEndFrame: number;
  rawStartFrame: number;
  tempo: number;
  getSamples: () => Float32Array;
};

type Region = {
  songStart: number;
  songEnd: number;
  sourceStart: number;
  sourceLength: number;
  piece?: SpectrogramSourcePiece;
  rawStart: number;
};

const layoutRegions = (
  pieces: readonly SpectrogramSourcePiece[],
  songLength: number,
): Region[] => {
  const regions: Region[] = [];
  let song = 0;
  let cursor = 0;
  const addGap = (end: number) => {
    const length = Math.max(0, Math.round(end) - Math.round(song));
    if (length > 0) {
      regions.push({
        songStart: song,
        songEnd: end,
        sourceStart: cursor,
        sourceLength: length,
        rawStart: 0,
      });
      cursor += length;
    }
    song = end;
  };
  for (const piece of pieces) {
    if (piece.songStartFrame > song) {
      addGap(piece.songStartFrame);
    }
    const rawEnd =
      piece.rawStartFrame +
      (piece.songEndFrame - piece.songStartFrame) / piece.tempo;
    const rawStart = Math.round(piece.rawStartFrame);
    const length = Math.max(0, Math.round(rawEnd) - rawStart);
    regions.push({
      songStart: piece.songStartFrame,
      songEnd: piece.songEndFrame,
      sourceStart: cursor,
      sourceLength: length,
      piece,
      rawStart,
    });
    cursor += length;
    song = piece.songEndFrame;
  }
  addGap(Math.max(song, songLength));
  return regions;
};

const findRegion = (
  regions: readonly Region[],
  value: number,
  startOf: (region: Region) => number,
): number => {
  let low = 0;
  let high = regions.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (startOf(regions[middle]) <= value) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

export const createMappedSource = (
  pieces: readonly SpectrogramSourcePiece[],
  songLength: number,
): SpectrogramSource => {
  const regions = layoutRegions(pieces, songLength);
  const last = regions.at(-1);
  const length = last ? last.sourceStart + last.sourceLength : 0;
  const stretch = pieces.reduce(
    (largest, piece) => Math.max(largest, 1 / piece.tempo),
    1,
  );
  const reach = pieces.reduce(
    (largest, piece) => Math.max(largest, piece.tempo),
    1,
  );

  return {
    mapped: true,
    songLength,
    length,
    stretch,
    reach,
    position: (songFrame) => {
      if (regions.length === 0) {
        return songFrame;
      }
      const region =
        regions[findRegion(regions, songFrame, (item) => item.songStart)];
      const { piece } = region;
      if (!piece) {
        return region.sourceStart + songFrame - Math.round(region.songStart);
      }
      const raw =
        piece.rawStartFrame + (songFrame - piece.songStartFrame) / piece.tempo;
      return region.sourceStart + raw - region.rawStart;
    },
    read: (target, targetOffset, from, count) => {
      target.fill(0, targetOffset, targetOffset + count);
      if (regions.length === 0) {
        return;
      }
      const end = from + count;
      let index = findRegion(regions, from, (item) => item.sourceStart);
      for (; index < regions.length; index += 1) {
        const region = regions[index];
        if (region.sourceStart >= end) {
          break;
        }
        const { piece } = region;
        const regionEnd = region.sourceStart + region.sourceLength;
        const start = Math.max(from, region.sourceStart);
        const stop = Math.min(end, regionEnd);
        if (!piece || stop <= start) {
          continue;
        }
        copyRange({
          source: piece.getSamples(),
          sourceStart: region.rawStart + start - region.sourceStart,
          target,
          targetOffset: targetOffset + start - from,
          count: stop - start,
        });
      }
    },
  };
};
