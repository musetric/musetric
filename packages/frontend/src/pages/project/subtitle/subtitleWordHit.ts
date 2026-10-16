import { type SubtitleWordRef } from '../loop/loopRange.js';

const wordSelector = '[data-subtitle-word-index]';
const segmentSelector = '[data-subtitle-segment-index]';
const lineDistanceWeight = 1000;

const getDistance = (rect: DOMRect, clientX: number, clientY: number) => {
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return dy * lineDistanceWeight + dx;
};

const findNearest = (
  elements: Iterable<HTMLElement>,
  clientX: number,
  clientY: number,
): HTMLElement | undefined => {
  let nearest: HTMLElement | undefined = undefined;
  let nearestDistance = Infinity;
  for (const element of elements) {
    const distance = getDistance(
      element.getBoundingClientRect(),
      clientX,
      clientY,
    );
    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
  }
  return nearest;
};

const toWordRef = (word: HTMLElement): SubtitleWordRef | undefined => {
  const segment = word.closest<HTMLElement>(segmentSelector);
  if (!segment) {
    return undefined;
  }
  return {
    segmentIndex: Number(segment.dataset.subtitleSegmentIndex),
    wordIndex: Number(word.dataset.subtitleWordIndex),
  };
};

const findWordInSegment = (
  segment: HTMLElement,
  clientX: number,
  clientY: number,
): SubtitleWordRef | undefined => {
  const word = findNearest(
    segment.querySelectorAll<HTMLElement>(wordSelector),
    clientX,
    clientY,
  );
  return word ? toWordRef(word) : undefined;
};

export const findSubtitleWordFromTarget = (
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): SubtitleWordRef | undefined => {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const word = target.closest<HTMLElement>(wordSelector);
  if (word) {
    return toWordRef(word);
  }
  const segment = target.closest<HTMLElement>(segmentSelector);
  return segment ? findWordInSegment(segment, clientX, clientY) : undefined;
};

export const findSubtitleWordAt = (
  list: HTMLElement,
  clientX: number,
  clientY: number,
): SubtitleWordRef | undefined => {
  const rect = list.getBoundingClientRect();
  const x = Math.min(Math.max(clientX, rect.left + 1), rect.right - 1);
  const y = Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1);
  const hit = document.elementFromPoint(x, y);
  if (hit && list.contains(hit)) {
    const direct = findSubtitleWordFromTarget(hit, x, y);
    if (direct) {
      return direct;
    }
  }
  const segment = findNearest(
    list.querySelectorAll<HTMLElement>(segmentSelector),
    x,
    y,
  );
  return segment ? findWordInSegment(segment, x, y) : undefined;
};
