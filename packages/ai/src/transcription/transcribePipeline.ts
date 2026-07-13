import {
  buildCompaction,
  computePackedChunks,
  remapSegmentsToOriginal,
} from './audioCompaction.js';
import { repairCollapsedWindows } from './collapseRepair.js';
import { filterHallucinatedSegments } from './hallucinationFilter.js';
import { splitSegmentsByLyrics } from './lyricSplitter.js';
import { buildPayloadSegments } from './responseBuilder.js';
import { filterSilentSegments } from './silenceFilter.js';
import { sampleRate } from './spectralChunker.js';
import {
  type PayloadSegment,
  type TranscriptionSegment,
  type TranscriptionWord,
} from './types.js';

const defaultChunkSize = 30;
const defaultSegmentGapSeconds = 1.0;

const defaultBatchSize = 1;

export type DetectLanguage = (audio: Float32Array) => Promise<string>;

const resolveLanguage = async (
  compacted: Float32Array,
  chunks: { start: number; end: number }[],
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

export type TranscribeBatch = (
  audios: Float32Array[],
  language: string,
) => Promise<TranscriptionWord[][]>;

export type RunTranscriptionOptions = {
  audio: Float32Array;
  transcribeBatch: TranscribeBatch;

  language?: string;
  detectLanguage?: DetectLanguage;

  chunkSize?: number;
  segmentGapSeconds?: number;
  batchSize?: number;

  onProgress?: (fraction: number) => void | Promise<void>;
};

export const runTranscription = async (
  options: RunTranscriptionOptions,
): Promise<PayloadSegment[]> => {
  const { audio, transcribeBatch } = options;
  const chunkSize = options.chunkSize ?? defaultChunkSize;
  const gap = options.segmentGapSeconds ?? defaultSegmentGapSeconds;
  const batchSize = options.batchSize ?? defaultBatchSize;

  const packed = computePackedChunks(audio, chunkSize);
  const { compacted, chunks, mapping } = buildCompaction(audio, packed);
  if (compacted.length === 0) {
    return [];
  }

  const language =
    options.language ??
    (options.detectLanguage
      ? await resolveLanguage(compacted, chunks, options.detectLanguage)
      : 'en');

  const wordsPerChunk: TranscriptionWord[][] = chunks.map(() => []);
  for (let start = 0; start < chunks.length; start += batchSize) {
    const group = chunks.slice(start, start + batchSize);
    const slices = group.map((chunk) =>
      compacted.subarray(
        Math.round(chunk.start * sampleRate),
        Math.round(chunk.end * sampleRate),
      ),
    );
    const groupWords = await transcribeBatch(slices, language);
    group.forEach((chunk, index) => {
      wordsPerChunk[start + index] = (groupWords[index] ?? []).map((word) => ({
        text: word.text,
        start: word.start + chunk.start,
        end: word.end + chunk.start,
      }));
    });
    await options.onProgress?.(
      Math.min(start + batchSize, chunks.length) / chunks.length,
    );
  }

  const repaired = await repairCollapsedWindows({
    compacted,
    chunks,
    packed,
    wordsPerChunk,
    mapping,
    transcribeSlice: async (slice) =>
      (await transcribeBatch([slice], language))[0] ?? [],
  });
  const words = repaired.flat().sort((a, b) => a.start - b.start);

  let segments = groupWordsIntoSegments(words, gap);

  segments = filterSilentSegments(segments, compacted, sampleRate);
  segments = filterHallucinatedSegments(segments);

  segments = remapSegmentsToOriginal(segments, mapping);
  segments = splitSegmentsByLyrics(segments);
  return buildPayloadSegments(segments);
};
