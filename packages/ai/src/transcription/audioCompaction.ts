import { computeChunks, sampleRate, type Span } from './spectralChunker.js';

export const computePackedChunks = (
  audio: Float32Array,
  chunkSize: number,
  seamSeconds: number,
  minChunk?: number,
): Span[][] => {
  const spans = computeChunks(audio, chunkSize, minChunk);
  const packed: Span[][] = [];
  let current: Span[] = [];
  let currentTotal = 0;
  for (const [start, end] of spans) {
    const duration = end - start;
    let seam = current.length > 0 ? seamSeconds : 0;
    if (current.length > 0 && currentTotal + seam + duration > chunkSize) {
      packed.push(current);
      current = [];
      currentTotal = 0;
      seam = 0;
    }
    current.push([start, end]);
    currentTotal += seam + duration;
  }
  if (current.length > 0) {
    packed.push(current);
  }
  return packed;
};

export type Mapping = [number, number, number];

export type Chunk = {
  start: number;
  end: number;
  segments: Span[];
};

type Piece = {
  from: number;
  to: number;
  pad: boolean;
};

export type Layout = {
  chunks: Chunk[];
  mapping: Mapping[];
  pieces: Piece[];
  totalSamples: number;
};

export const buildLayout = (
  packedChunks: Span[][],
  seamSeconds: number,
): Layout => {
  const chunks: Chunk[] = [];
  const mapping: Mapping[] = [];
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const chunk of packedChunks) {
    const chunkStart = cursor;
    let prevEnd: number | undefined = undefined;
    for (const [start, end] of chunk) {
      const lo = Math.round(start * sampleRate);
      const hi = Math.round(end * sampleRate);
      if (hi <= lo) {
        continue;
      }
      if (prevEnd !== undefined && seamSeconds > 0) {
        const padSamples = Math.round(seamSeconds * sampleRate);
        pieces.push({ from: 0, to: padSamples, pad: true });
        mapping.push([cursor, cursor + seamSeconds, prevEnd]);
        cursor += seamSeconds;
      }
      pieces.push({ from: lo, to: hi, pad: false });
      const duration = (hi - lo) / sampleRate;
      mapping.push([cursor, cursor + duration, lo / sampleRate]);
      cursor += duration;
      prevEnd = end;
    }
    if (cursor > chunkStart) {
      chunks.push({
        start: chunkStart,
        end: cursor,
        segments: [[chunkStart, cursor]],
      });
    }
  }
  let totalSamples = 0;
  for (const piece of pieces) {
    totalSamples += piece.to - piece.from;
  }
  return { chunks, mapping, pieces, totalSamples };
};

export type Compaction = {
  compacted: Float32Array<ArrayBuffer>;
  chunks: Chunk[];
  mapping: Mapping[];
};

export const buildCompaction = (
  audio: Float32Array,
  packedChunks: Span[][],
  seamSeconds: number,
): Compaction => {
  const layout = buildLayout(packedChunks, seamSeconds);
  const compacted = new Float32Array(layout.totalSamples);
  let writeOffset = 0;
  for (const piece of layout.pieces) {
    const length = piece.to - piece.from;
    if (!piece.pad) {
      compacted.set(audio.subarray(piece.from, piece.to), writeOffset);
    }
    writeOffset += length;
  }
  return { compacted, chunks: layout.chunks, mapping: layout.mapping };
};

export const mapTime = (
  compactedSeconds: number,
  mapping: Mapping[],
): number => {
  if (mapping.length === 0) {
    return compactedSeconds;
  }
  for (const [compStart, compEnd, originalStart] of mapping) {
    if (compactedSeconds < compEnd) {
      const offset = Math.max(0, compactedSeconds - compStart);
      return originalStart + offset;
    }
  }
  const [compStart, compEnd, originalStart] = mapping[mapping.length - 1];
  return originalStart + (compEnd - compStart);
};

export const remapSegmentsToOriginal = <
  T extends {
    start?: number;
    end?: number;
    words?: { start?: number; end?: number }[];
  },
>(
  segments: T[],
  mapping: Mapping[],
): T[] => {
  const round3 = (value: number): number => Math.round(value * 1000) / 1000;
  for (const segment of segments) {
    if (segment.start !== undefined) {
      segment.start = round3(mapTime(segment.start, mapping));
    }
    if (segment.end !== undefined) {
      segment.end = round3(mapTime(segment.end, mapping));
    }
    for (const word of segment.words ?? []) {
      if (word.start !== undefined) {
        word.start = round3(mapTime(word.start, mapping));
      }
      if (word.end !== undefined) {
        word.end = round3(mapTime(word.end, mapping));
      }
    }
  }
  return segments;
};
