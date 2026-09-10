import { yieldGpuToCompositor } from '../runtime/gpuCooldown.js';
import {
  buildCompaction,
  buildLayout,
  type Chunk,
  computePackedChunks,
  type Layout,
  type Mapping,
  remapSegmentsToOriginal,
} from './audioCompaction.js';
import { repairCollapsedWindows } from './collapseRepair.js';
import { filterHallucinatedSegments } from './hallucinationFilter.js';
import { splitSegmentsByLyrics } from './lyricSplitter.js';
import { buildPayloadSegments } from './responseBuilder.js';
import { filterSilentSegments } from './silenceFilter.js';
import { sampleRate, type Span } from './spectralChunker.js';
import {
  type PayloadSegment,
  type TranscriptionSegment,
  type TranscriptionWord,
} from './types.js';

const defaultSegmentGapSeconds = 1.0;

export const groupWordsIntoSegments = (
  words: TranscriptionWord[],
  gap: number,
): TranscriptionSegment[] => {
  const segments: TranscriptionSegment[] = [];
  let current: TranscriptionWord[] = [];
  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current
        .map((word) => word.text.trim())
        .filter(Boolean)
        .join(' '),
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    if (
      current.length > 0 &&
      word.start - current[current.length - 1].end > gap
    ) {
      flush();
    }
    current.push({ ...word, text: word.text.trim() });
  }
  flush();
  return segments;
};

const shiftWords = (
  words: TranscriptionWord[],
  offset: number,
): TranscriptionWord[] =>
  words.map((word) => ({
    text: word.text,
    start: word.start + offset,
    end: word.end + offset,
  }));

export type DetectLanguage = (audio: Float32Array) => Promise<string>;

const resolveLanguage = async (
  compacted: Float32Array,
  chunks: Chunk[],
  detectLanguage: DetectLanguage,
): Promise<string> => {
  const sampleCount = Math.min(3, chunks.length);
  const votes = new Map<string, number>();
  for (let i = 0; i < sampleCount; i++) {
    const chunk = chunks[Math.floor((i * chunks.length) / sampleCount)];
    const slice = compacted.subarray(
      Math.round(chunk.start * sampleRate),
      Math.round(chunk.end * sampleRate),
    );
    const language = await detectLanguage(slice);
    votes.set(language, (votes.get(language) ?? 0) + 1);
  }
  let best = 'en';
  let bestVotes = 0;
  for (const [language, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      best = language;
    }
  }
  return best;
};

export type PlanPass = {
  language: string;
  packed: Span[][];
};

type PlanPassOptions = {
  chunkSize: number;
  seamSeconds: number;
  language?: string;
  detectLanguage?: DetectLanguage;
};

export const planPass = async (
  audio: Float32Array,
  options: PlanPassOptions,
): Promise<PlanPass> => {
  const packed = computePackedChunks(
    audio,
    options.chunkSize,
    options.seamSeconds,
  );
  if (packed.length === 0) {
    return { language: '', packed };
  }
  const { compacted, chunks } = buildCompaction(
    audio,
    packed,
    options.seamSeconds,
  );
  const fallback = options.detectLanguage
    ? await resolveLanguage(compacted, chunks, options.detectLanguage)
    : undefined;
  const language = options.language ?? fallback ?? 'en';
  return { language, packed };
};

export type TranscribeBatch = (
  audios: Float32Array[],
  language: string,
) => Promise<TranscriptionWord[][]>;

export const decodeChunkPass = async (
  slice: Float32Array,
  language: string,
  transcribeBatch: TranscribeBatch,
): Promise<TranscriptionWord[]> => {
  await yieldGpuToCompositor();
  const [words] = await transcribeBatch([slice], language);
  return words.map((word) => ({
    text: word.text,
    start: word.start,
    end: word.end,
  }));
};

export type TranscribeAligned = (
  audio: Float32Array,
  language: string,
) => Promise<TranscriptionWord[]>;

type RepairPassOptions = {
  compacted: Float32Array;
  packed: Span[][];
  chunks: Chunk[];
  mapping: Mapping[];
  words: TranscriptionWord[][];
  language: string;
  transcribeAligned?: TranscribeAligned;
  transcribeBatch: TranscribeBatch;
};

export type Replacement = {
  index: number;
  words: TranscriptionWord[];
};

export const repairPass = async (
  options: RepairPassOptions,
): Promise<Replacement[]> => {
  const shifted = options.words.map((words, index) =>
    shiftWords(words, options.chunks[index].start),
  );
  const repaired = await repairCollapsedWindows({
    compacted: options.compacted,
    chunks: options.chunks,
    packed: options.packed,
    wordsPerChunk: shifted,
    mapping: options.mapping,
    transcribeSlice: async (slice) =>
      options.transcribeAligned
        ? await options.transcribeAligned(slice, options.language)
        : ((await options.transcribeBatch([slice], options.language))[0] ?? []),
  });
  return repaired.flatMap((words, index) =>
    words === shifted[index] ? [] : [{ index, words }],
  );
};

type FinalizePassOptions = {
  compacted: Float32Array;
  packed: Span[][];
  seamSeconds: number;
  words: TranscriptionWord[][];
  replaced: Replacement[];
};

export const finalizePass = (
  options: FinalizePassOptions,
): PayloadSegment[] => {
  const layout: Layout = buildLayout(options.packed, options.seamSeconds);
  const repairs = new Map(
    options.replaced.map((entry) => [entry.index, entry.words]),
  );
  const words = layout.chunks
    .flatMap(
      (chunk, index) =>
        repairs.get(index) ?? shiftWords(options.words[index], chunk.start),
    )
    .sort((a, b) => a.start - b.start);
  let segments = groupWordsIntoSegments(words, defaultSegmentGapSeconds);
  segments = filterSilentSegments(segments, options.compacted, sampleRate);
  segments = filterHallucinatedSegments(segments);
  segments = remapSegmentsToOriginal(segments, layout.mapping);
  segments = splitSegmentsByLyrics(segments);
  return buildPayloadSegments(segments);
};
