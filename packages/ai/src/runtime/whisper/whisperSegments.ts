import { uniqueRatio } from '../../transcription/collapseRepair.js';
import { type TranscriptionWord } from '../../transcription/types.js';

const degenerateRepeat = /(.{1,3}?)\1{3,}/gu;

const collapseRepeats = (text: string): string =>
  text.replace(degenerateRepeat, '$1$1');

export type WordChunk = { text: string; timestamp: [number, number | null] };

export const extractWords = (chunks: WordChunk[]): TranscriptionWord[] => {
  const words: TranscriptionWord[] = [];
  for (const chunk of chunks) {
    const text = collapseRepeats(chunk.text.trim());
    if (!text) {
      continue;
    }

    const [start, rawEnd] = chunk.timestamp;
    const end = rawEnd ?? start;
    words.push({ text, start, end });
  }
  return words;
};

export const spanText = (chunks: WordChunk[]): string =>
  chunks
    .map((chunk) => chunk.text)
    .join('')
    .trim();

const lastWordEnd = (chunks: WordChunk[]): number => {
  const last = chunks.at(-1);
  return last ? (last.timestamp[1] ?? last.timestamp[0]) : 0;
};

const widestGap = (chunks: WordChunk[]): number => {
  let widest = 0;
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1];
    const previousEnd = previous.timestamp[1] ?? previous.timestamp[0];
    widest = Math.max(widest, chunks[index].timestamp[0] - previousEnd);
  }
  return widest;
};

export type HalvesRule = {
  minSeconds: number;
  coverage: number;
  maxGap: number;
};

export const needsHalves = (
  chunks: WordChunk[],
  duration: number,
  rule: HalvesRule,
): boolean =>
  duration >= rule.minSeconds &&
  (lastWordEnd(chunks) < rule.coverage * duration ||
    widestGap(chunks) >= rule.maxGap);

export const joinHalves = (
  first: WordChunk[],
  second: WordChunk[],
  offset: number,
): WordChunk[] => [
  ...first,
  ...second.map((chunk): WordChunk => ({
    text: chunk.text,
    timestamp: [
      chunk.timestamp[0] + offset,
      (chunk.timestamp[1] ?? chunk.timestamp[0]) + offset,
    ],
  })),
];

export const countWords = (text: string | undefined): number =>
  (text ?? '').trim().split(/\s+/).filter(Boolean).length;

const compressionRatio = async (text: string): Promise<number> => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length < 48) {
    return 0;
  }
  const compressedStream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(compressedStream).arrayBuffer();
  return bytes.length / compressed.byteLength;
};

const loopCompressionRatio = 3.5;
const loopUniqueRatio = 0.35;

export const isLooped = async (text: string): Promise<boolean> =>
  (await compressionRatio(text)) > loopCompressionRatio &&
  uniqueRatio(text) < loopUniqueRatio;

type SegmentBounds = [number, number][];

const readBounds = (
  tokens: number[],
  timestampBegin: number,
  timePrecision: number,
): SegmentBounds => {
  const bounds: SegmentBounds = [];
  let open: number | undefined = undefined;
  for (const token of tokens) {
    if (token < timestampBegin) {
      continue;
    }
    const time = (token - timestampBegin) * timePrecision;
    if (open === undefined) {
      open = time;
      continue;
    }
    bounds.push([open, time]);
    open = undefined;
  }
  return bounds;
};

export type SplitOptions = {
  tokens: number[];
  words: WordChunk[];
  timestampBegin: number;
  timePrecision: number;
};

export const splitBySegments = (options: SplitOptions): WordChunk[][] => {
  const { tokens, words, timestampBegin, timePrecision } = options;
  const bounds = readBounds(tokens, timestampBegin, timePrecision);
  if (bounds.length === 0) {
    return words.length > 0 ? [words] : [];
  }

  const segments: WordChunk[][] = bounds.map(() => []);
  for (const word of words) {
    let index = bounds.length - 1;
    for (const [candidate, [, end]] of bounds.entries()) {
      if (word.timestamp[0] <= end) {
        index = candidate;
        break;
      }
    }
    segments[index].push(word);
  }
  return segments.filter((segment) => segment.length > 0);
};
