import { type api } from '@musetric/api';
import { type EngineState } from '@musetric/engine';
import { getSubtitleSegmentEndTime } from './subtitleTiming.js';

const wordInset = 4;

export const getSubtitleLoopWordsKey = (
  segment: api.subtitle.Segment,
  state: Pick<EngineState, 'range' | 'loopStage'>,
  sampleRate: number,
): string => {
  const { range } = state;
  if (!range || state.loopStage === undefined) {
    return '';
  }
  const from = range.fromFrame / sampleRate;
  const to = range.toFrame / sampleRate;
  const { words } = segment;
  if (words.length === 0) {
    return segment.start < to && getSubtitleSegmentEndTime(segment) > from
      ? 'all'
      : '';
  }
  const inside = (word: api.subtitle.Word) => {
    const middle = (word.start + word.end) / 2;
    return middle >= from && middle <= to;
  };
  const first = words.findIndex(inside);
  if (first < 0) {
    return '';
  }
  const last = words.findLastIndex(inside);
  return first === 0 && last === words.length - 1 ? 'all' : `${first}:${last}`;
};

export type SubtitleLoopWords = {
  first: number;
  last: number;
};

export const parseSubtitleLoopWordsKey = (
  key: string,
): SubtitleLoopWords | undefined => {
  if (!key.includes(':')) {
    return undefined;
  }
  const [first, last] = key.split(':').map(Number);
  return { first, last };
};

type WordBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const getWordBoxes = (segment: HTMLElement): WordBox[] => {
  const origin = segment.getBoundingClientRect();
  const elements = segment.querySelectorAll<HTMLElement>(
    '[data-subtitle-word-index]',
  );
  return Array.from(elements, (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - origin.left,
      right: rect.right - origin.left,
      top: rect.top - origin.top,
      bottom: rect.bottom - origin.top,
    };
  });
};

type WordRow = {
  first: number;
  last: number;
  top: number;
  bottom: number;
};

const getWordRows = (boxes: WordBox[]): WordRow[] => {
  const rows: WordRow[] = [];
  boxes.forEach((box, index) => {
    const row = rows.at(-1);
    if (row && box.top < (row.top + row.bottom) / 2) {
      row.last = index;
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({
        first: index,
        last: index,
        top: box.top,
        bottom: box.bottom,
      });
    }
  });
  return rows;
};

export type SubtitleLoopBand = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const getSubtitleLoopBands = (
  segment: HTMLElement,
  words: SubtitleLoopWords,
): SubtitleLoopBand[] => {
  const { first, last } = words;
  const width = segment.clientWidth;
  const height = segment.clientHeight;
  const boxes = getWordBoxes(segment);
  const rows = getWordRows(boxes);
  const lastWord = boxes.length - 1;
  return rows.flatMap((row, index) => {
    if (row.last < first || row.first > last) {
      return [];
    }
    const previous = rows.at(index - 1);
    const next = rows.at(index + 1);
    const top = index > 0 && previous ? (previous.bottom + row.top) / 2 : 0;
    const bottom = next ? (row.bottom + next.top) / 2 : height;
    const left =
      first === 0 || first < row.first ? 0 : boxes[first].left - wordInset;
    const right =
      last === lastWord || last > row.last
        ? width
        : boxes[last].right + wordInset;
    return [{ left, top, width: right - left, height: bottom - top }];
  });
};
