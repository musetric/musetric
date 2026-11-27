export type SpectrogramSourceRun = (
  samples: Float32Array | undefined,
  samplesStart: number,
  offset: number,
  count: number,
) => void;

export type SamplesSpan = {
  samples: Float32Array;
  samplesStart: number;
  offset: number;
  count: number;
};

export const visitSamples = (
  span: SamplesSpan,
  run: SpectrogramSourceRun,
): void => {
  const { samples, samplesStart, offset, count } = span;
  const start = Math.min(Math.max(0, samplesStart), samplesStart + count);
  const end = Math.max(Math.min(samples.length, samplesStart + count), start);
  if (start > samplesStart) {
    run(undefined, 0, offset, start - samplesStart);
  }
  if (end > start) {
    run(samples, start, offset + start - samplesStart, end - start);
  }
  if (samplesStart + count > end) {
    run(undefined, 0, offset + end - samplesStart, samplesStart + count - end);
  }
};

export type SpectrogramSource = {
  mapped: boolean;
  songLength: number;
  length: number;
  stretch: number;
  reach: number;
  position: (songFrame: number) => number;
  transposeAt: (songFrame: number) => number;
  forEachRun: (from: number, count: number, run: SpectrogramSourceRun) => void;
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
  transposeAt: () => 0,
  forEachRun: (from, count, run) => {
    visitSamples({ samples, samplesStart: from, offset: 0, count }, run);
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
  transpose: number;
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
    transposeAt: (songFrame) => {
      if (regions.length === 0) {
        return 0;
      }
      const region =
        regions[findRegion(regions, songFrame, (item) => item.songStart)];
      return region.piece?.transpose ?? 0;
    },
    forEachRun: (from, count, run) => {
      const end = from + count;
      let cursor = from;
      if (regions.length > 0) {
        let index = findRegion(regions, from, (item) => item.sourceStart);
        for (; index < regions.length && cursor < end; index += 1) {
          const region = regions[index];
          if (region.sourceStart >= end) {
            break;
          }
          const { piece } = region;
          const regionEnd = region.sourceStart + region.sourceLength;
          const start = Math.max(cursor, region.sourceStart);
          const stop = Math.min(end, regionEnd);
          if (!piece || stop <= start) {
            continue;
          }
          if (start > cursor) {
            run(undefined, 0, cursor - from, start - cursor);
          }
          visitSamples(
            {
              samples: piece.getSamples(),
              samplesStart: region.rawStart + start - region.sourceStart,
              offset: start - from,
              count: stop - start,
            },
            run,
          );
          cursor = stop;
        }
      }
      if (end > cursor) {
        run(undefined, 0, cursor - from, end - cursor);
      }
    },
  };
};
