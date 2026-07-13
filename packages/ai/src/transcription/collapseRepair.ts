import { type Chunk, type Mapping } from './audioCompaction.js';
import { isHallucination } from './hallucinationFilter.js';
import { sampleRate, type Span } from './spectralChunker.js';
import { syllableOnsets } from './syllableOnsets.js';
import { type TranscriptionWord } from './types.js';

const minWindowSeconds = 12.0;
const minOnsetRate = 2.0;
const maxCoveredFraction = 0.3;
const minUncoveredSeconds = 8.0;
const minRepairWordGain = 3;
const minUniqueRatio = 0.35;

const windowCapSeconds = 30.0;
const runwaySeconds = 15.0;
const runwayPadSeconds = 1.5;
const runwaySnapSeconds = 2.5;
const minHalfSeconds = 6.0;
const minCleanPayloadSeconds = 6.0;
const minRunwayBudgetSeconds = 4.0;

const loopMinTokens = 4;
const loopRunLength = 6;
const loopDominanceMinTokens = 8;
const loopDominanceRatio = 0.6;

const wordsText = (words: TranscriptionWord[]): string =>
  words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ');

const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const normalizeTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

const uniqueRatio = (text: string): number => {
  const tokens = normalizeTokens(text);
  if (tokens.length === 0) {
    return 1.0;
  }
  return new Set(tokens).size / tokens.length;
};

const looksLooped = (text: string): boolean => {
  const tokens = normalizeTokens(text);
  if (tokens.length < loopMinTokens) {
    return false;
  }
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < tokens.length; i++) {
    run = tokens[i] === tokens[i - 1] ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  if (longestRun >= loopRunLength) {
    return true;
  }
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let top = 0;
  for (const value of counts.values()) {
    top = Math.max(top, value);
  }
  return (
    tokens.length >= loopDominanceMinTokens &&
    top / tokens.length >= loopDominanceRatio
  );
};

const wordCoverage = (
  words: TranscriptionWord[],
  start: number,
  end: number,
): number => {
  let covered = 0;
  for (const word of words) {
    const lo = Math.max(start, word.start);
    const hi = Math.min(end, word.end);
    if (hi > lo) {
      covered += hi - lo;
    }
  }
  return covered;
};

const sliceSeconds = (
  audio: Float32Array,
  startSeconds: number,
  endSeconds: number,
): Float32Array =>
  audio.subarray(
    Math.max(0, Math.round(startSeconds * sampleRate)),
    Math.min(audio.length, Math.round(endSeconds * sampleRate)),
  );

const concatRunway = (head: Float32Array, tail: Float32Array): Float32Array => {
  const padSamples = Math.round(runwayPadSeconds * sampleRate);
  const cap = Math.round(windowCapSeconds * sampleRate);
  const total = Math.min(cap, head.length + padSamples + tail.length);
  const out = new Float32Array(total);
  out.set(head.subarray(0, Math.min(head.length, total)), 0);
  const tailStart = head.length + padSamples;
  if (tailStart < total) {
    out.set(tail.subarray(0, total - tailStart), tailStart);
  }
  return out;
};

export type RepairOptions = {
  compacted: Float32Array;

  chunks: Chunk[];

  packed: Span[][];

  wordsPerChunk: TranscriptionWord[][];

  mapping: Mapping[];

  transcribeSlice: (audio: Float32Array) => Promise<TranscriptionWord[]>;

  log?: (message: string) => void;
};

type RebuiltHalf = {
  words: TranscriptionWord[];
  count: number;
};

type HalfBuild = {
  payloadStart: number;
  payloadEnd: number;
  runway: Float32Array;
  seam: number;
};

const rebuildHalf = async (
  options: RepairOptions,
  half: HalfBuild,
): Promise<RebuiltHalf | undefined> => {
  const { payloadStart, payloadEnd, runway, seam } = half;
  const slice = concatRunway(
    runway,
    sliceSeconds(options.compacted, payloadStart, payloadEnd),
  );
  const decoded = await options.transcribeSlice(slice);

  const payloadWords = decoded.filter((word) => word.start >= seam);
  const text = wordsText(payloadWords);
  const count = wordCount(text);
  const sane =
    count >= minRepairWordGain &&
    uniqueRatio(text) >= minUniqueRatio &&
    !looksLooped(text) &&
    !isHallucination(text);
  if (!sane) {
    return undefined;
  }

  const words = payloadWords.map((word) => ({
    text: word.text,
    start: payloadStart + (word.start - seam),
    end: payloadStart + (word.end - seam),
  }));
  return { words, count };
};

const buildSnap = (mapping: Mapping[]): ((target: number) => number) => {
  const cutSet = new Set<number>();
  for (const [compStart, compEnd] of mapping) {
    cutSet.add(Math.round(compStart * 1000) / 1000);
    cutSet.add(Math.round(compEnd * 1000) / 1000);
  }
  const cutPoints = [...cutSet].sort((a, b) => a - b);
  return (target) => {
    let best = target;
    let bestDistance = runwaySnapSeconds;
    for (const cut of cutPoints) {
      const distance = Math.abs(cut - target);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = cut;
      }
    }
    return best;
  };
};

const flagCollapsedWindows = (
  options: RepairOptions,
  result: TranscriptionWord[][],
  payloads: number[],
): boolean[] => {
  const { compacted, chunks } = options;
  return chunks.map((chunk, index) => {
    const { start, end } = chunk;
    const payload = payloads[index] ?? end - start;
    const onsets = syllableOnsets(sliceSeconds(compacted, start, end));
    const cover = wordCoverage(result[index], start, end);
    const collapse =
      payload >= minWindowSeconds &&
      onsets / payload >= minOnsetRate &&
      cover / payload < maxCoveredFraction &&
      payload - cover >= minUncoveredSeconds;
    return collapse || isHallucination(wordsText(result[index]));
  });
};

type RepairContext = {
  options: RepairOptions;
  result: TranscriptionWord[][];
  flagged: boolean[];
  payloads: number[];
  snap: (target: number) => number;
};

type WindowRepair = {
  words: TranscriptionWord[];
  origWords: number;
  totalWords: number;
};

const repairWindow = async (
  context: RepairContext,
  index: number,
): Promise<WindowRepair | undefined> => {
  const { options, result, flagged, payloads, snap } = context;
  const { compacted, chunks } = options;
  const { start, end } = chunks[index];

  let runwayAnchor = start;
  for (let j = index - 1; j >= 0; j--) {
    if (!flagged[j] && (payloads[j] ?? 0) >= minCleanPayloadSeconds) {
      runwayAnchor = chunks[j].end;
      break;
    }
  }
  if (runwayAnchor < runwaySeconds + 0.5) {
    return undefined;
  }

  const middle = Math.min(
    Math.max(snap((start + end) / 2), start + minHalfSeconds),
    end - minHalfSeconds,
  );
  if (middle <= start || middle >= end) {
    return undefined;
  }
  const budget = Math.min(
    runwaySeconds,
    windowCapSeconds - runwayPadSeconds - (middle - start),
    windowCapSeconds - runwayPadSeconds - (end - middle),
  );
  if (budget < minRunwayBudgetSeconds) {
    return undefined;
  }
  const runwayStart = Math.max(0, runwayAnchor - budget);
  const runway = sliceSeconds(compacted, runwayStart, runwayAnchor);
  const seam = runwayAnchor - runwayStart + runwayPadSeconds;

  const halves = await Promise.all([
    rebuildHalf(options, {
      payloadStart: start,
      payloadEnd: middle,
      runway,
      seam,
    }),
    rebuildHalf(options, {
      payloadStart: middle,
      payloadEnd: end,
      runway,
      seam,
    }),
  ]);
  const kept = halves.filter((half): half is RebuiltHalf => half !== undefined);
  const origWords = wordCount(wordsText(result[index]));
  const totalWords = kept.reduce((sum, half) => sum + half.count, 0);
  if (kept.length === 0 || totalWords < origWords + minRepairWordGain) {
    return undefined;
  }
  return { words: kept.flatMap((half) => half.words), origWords, totalWords };
};

export const repairCollapsedWindows = async (
  options: RepairOptions,
): Promise<TranscriptionWord[][]> => {
  const { chunks, packed, wordsPerChunk, mapping } = options;
  const log = options.log ?? ((): void => undefined);
  const result = wordsPerChunk.map((words) => words);
  const payloads = packed.map((spans) =>
    spans.reduce((sum, span) => sum + (span[1] - span[0]), 0),
  );
  const snap = buildSnap(mapping);
  const flagged = flagCollapsedWindows(options, result, payloads);
  const context: RepairContext = { options, result, flagged, payloads, snap };

  for (let index = 0; index < chunks.length; index++) {
    if (!flagged[index]) {
      continue;
    }
    const repair = await repairWindow(context, index);
    if (!repair) {
      continue;
    }
    result[index] = repair.words;
    log(
      `collapse repair @ window ${index} (${chunks[index].start.toFixed(1)}s): ` +
        `${repair.origWords} -> ${repair.totalWords} words`,
    );
  }

  return result;
};
