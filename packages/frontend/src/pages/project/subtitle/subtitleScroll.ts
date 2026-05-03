import { type RefObject } from 'react';

const subtitleSegmentIndexAttribute = 'data-subtitle-segment-index';
const subtitleWordStartAttribute = 'data-subtitle-word-start';

const getEventTargetElement = (eventTarget: EventTarget) => {
  if (eventTarget instanceof HTMLElement) {
    return eventTarget;
  }

  if (eventTarget instanceof Node) {
    return eventTarget.parentElement ?? undefined;
  }

  return undefined;
};

const getSubtitleSegmentCenterY = (segmentElement: HTMLElement) => {
  const segmentRect = segmentElement.getBoundingClientRect();

  return segmentRect.top + segmentRect.height / 2;
};

export const getSubtitleSegmentElement = (
  subtitleListElement: HTMLDivElement,
  segmentIndex: number,
) => {
  return subtitleListElement.querySelector<HTMLElement>(
    `[${subtitleSegmentIndexAttribute}="${segmentIndex}"]`,
  );
};

export const getClickedSubtitleWordElement = (eventTarget: EventTarget) => {
  const targetElement = getEventTargetElement(eventTarget);
  if (!targetElement) {
    return;
  }

  return targetElement.closest<HTMLElement>(`[${subtitleWordStartAttribute}]`);
};

export const getSubtitleWordStart = (wordElement: HTMLElement) => {
  const wordStart = wordElement.dataset.subtitleWordStart;

  return wordStart === undefined ? undefined : Number(wordStart);
};

export const getSubtitleSegmentElementFromWord = (wordElement: HTMLElement) => {
  return wordElement.closest<HTMLElement>(`[${subtitleSegmentIndexAttribute}]`);
};

export const getSubtitleSegmentElementIndex = (segmentElement: HTMLElement) => {
  const segmentIndex = segmentElement.dataset.subtitleSegmentIndex;

  return segmentIndex === undefined ? undefined : Number(segmentIndex);
};

export const isSubtitleListPointerBelowCenter = (
  subtitleListElement: HTMLDivElement,
  pointerClientY: number,
) => {
  const listRect = subtitleListElement.getBoundingClientRect();

  return pointerClientY >= listRect.top + listRect.height / 2;
};

export const shouldFollowFromSubtitleSegment = (
  subtitleListElement: HTMLDivElement,
  segmentElement: HTMLElement,
) => {
  const listRect = subtitleListElement.getBoundingClientRect();
  const listCenterY = listRect.top + listRect.height / 2;
  const segmentCenterY = getSubtitleSegmentCenterY(segmentElement);

  return segmentCenterY >= listCenterY && segmentCenterY <= listRect.bottom;
};

export const shouldCenterSoughtSubtitleSegment = (
  subtitleListElement: HTMLDivElement,
  segmentElement: HTMLElement,
) => {
  const listRect = subtitleListElement.getBoundingClientRect();
  const listCenterY = listRect.top + listRect.height / 2;
  const segmentCenterY = getSubtitleSegmentCenterY(segmentElement);
  const segmentCenterVisible =
    segmentCenterY >= listRect.top && segmentCenterY <= listRect.bottom;

  return !segmentCenterVisible || segmentCenterY > listCenterY;
};

export const scrollSubtitleSegmentToCenter = (
  segmentElement: HTMLElement,
  behavior: ScrollBehavior,
) => {
  segmentElement.scrollIntoView({
    block: 'center',
    behavior,
  });
};

export const scheduleSubtitleSegmentCentering = (
  segmentElement: HTMLElement,
  scrollFrameRef: RefObject<number | undefined>,
  behavior: ScrollBehavior,
) => {
  if (scrollFrameRef.current !== undefined) {
    window.cancelAnimationFrame(scrollFrameRef.current);
  }

  scrollFrameRef.current = window.requestAnimationFrame(() => {
    scrollSubtitleSegmentToCenter(segmentElement, behavior);
    scrollFrameRef.current = undefined;
  });
};
