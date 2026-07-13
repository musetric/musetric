import { computeChunks, sampleRate, type Span } from './spectralChunker.js';

const seamPadSeconds = 2.0;

export const computePackedChunks = (
  audio: Float32Array,
  chunkSize: number,
  minChunk?: number,
): Span[][] => {
  const spans = computeChunks(audio, chunkSize, minChunk);
  const packed: Span[][] = [];
  let current: Span[] = [];
  let currentTotal = 0;
  for (const [start, end] of spans) {
    const duration = end - start;
    let seam = current.length > 0 ? seamPadSeconds : 0;
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

export type Chunk = {
  start: number;
  end: number;
  segments: Span[];
};

export type Mapping = [number, number, number];

export type Compaction = {
  compacted: Float32Array;
  chunks: Chunk[];
  mapping: Mapping[];
};

export const buildCompaction = (
  audio: Float32Array,
  packedChunks: Span[][],
): Compaction => {
  const pieces: Float32Array[] = [];
  const chunks: Chunk[] = [];
  const mapping: Mapping[] = [];
  const padSamples = Math.round(seamPadSeconds * sampleRate);
  const pad = new Float32Array(padSamples);
  let cursor = 0;
  for (const chunk of packedChunks) {
    const chunkStart = cursor;
    let prevEnd: number | undefined = undefined;
    for (const [start, end] of chunk) {
      const lo = Math.max(0, Math.round(start * sampleRate));
      const hi = Math.min(audio.length, Math.round(end * sampleRate));
      if (hi <= lo) {
        continue;
      }
      if (prevEnd !== undefined && padSamples) {
        pieces.push(pad);
        mapping.push([cursor, cursor + seamPadSeconds, prevEnd]);
        cursor += seamPadSeconds;
      }
      const piece = audio.subarray(lo, hi);
      const duration = piece.length / sampleRate;
      pieces.push(piece);
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
  let totalLength = 0;
  for (const piece of pieces) {
    totalLength += piece.length;
  }
  const compacted = new Float32Array(totalLength);
  let writeOffset = 0;
  for (const piece of pieces) {
    compacted.set(piece, writeOffset);
    writeOffset += piece.length;
  }
  return { compacted, chunks, mapping };
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
