import { createFollowScrollController } from '@musetric/interaction';
import { type SubtitleCursor } from './subtitleCursor.js';

const subtitleSegmentIndexAttribute = 'data-subtitle-segment-index';
const subtitleWordStartAttribute = 'data-subtitle-word-start';

const getEventTargetElement = (eventTarget: EventTarget | null) => {
  if (eventTarget instanceof HTMLElement) return eventTarget;
  if (eventTarget instanceof Node)
    return eventTarget.parentElement ?? undefined;
  return undefined;
};

const getSubtitleSegmentElement = (
  subtitleListElement: HTMLDivElement,
  segmentIndex: number,
) =>
  subtitleListElement.querySelector<HTMLElement>(
    `[${subtitleSegmentIndexAttribute}="${segmentIndex}"]`,
  );

const getClickedSubtitleWordElement = (eventTarget: EventTarget | null) => {
  const targetElement = getEventTargetElement(eventTarget);
  if (!targetElement) return undefined;
  return targetElement.closest<HTMLElement>(`[${subtitleWordStartAttribute}]`);
};

const getSubtitleWordStart = (wordElement: HTMLElement) => {
  const wordStart = wordElement.dataset.subtitleWordStart;
  return wordStart === undefined ? undefined : Number(wordStart);
};

const getSubtitleSegmentElementFromWord = (wordElement: HTMLElement) =>
  wordElement.closest<HTMLElement>(`[${subtitleSegmentIndexAttribute}]`);

const getSubtitleSegmentElementIndex = (segmentElement: HTMLElement) => {
  const segmentIndex = segmentElement.dataset.subtitleSegmentIndex;
  return segmentIndex === undefined ? undefined : Number(segmentIndex);
};

type Unsubscribe = () => void;

export type SubtitleSeekEvent = {
  revision: number;
  origin: string;
};

export type SubtitleFollowControllerOptions = {
  element: HTMLDivElement;
  cursor: SubtitleCursor;
  subtitleLength: number;
  getSeekEvent: () => SubtitleSeekEvent;
  subscribeSeekRevision: (callback: () => void) => Unsubscribe;
  getSeekFrameIndex: (playbackTime: number) => number | undefined;
  seek: (frameIndex: number) => void;
  isIgnoredSeekOrigin: (origin: string) => boolean;
};

export type SubtitleFollowController = {
  reset: () => void;
  dispose: () => void;
};

export const createSubtitleFollowController = (
  options: SubtitleFollowControllerOptions,
): SubtitleFollowController => {
  const {
    element,
    cursor,
    subtitleLength,
    getSeekEvent,
    subscribeSeekRevision,
    getSeekFrameIndex,
    seek,
    isIgnoredSeekOrigin,
  } = options;

  const controller = createFollowScrollController({
    element,
    getActiveIndex: () => cursor.getActiveSegmentIndex(),
    subscribeActiveIndex: cursor.subscribeActiveSegmentIndex,
    locateElement: (index) => getSubtitleSegmentElement(element, index),
    getRevision: () => getSeekEvent().revision,
    subscribeRevision: subscribeSeekRevision,
    isRevisionIgnored: () => isIgnoredSeekOrigin(getSeekEvent().origin),
  });

  const handleClick = (event: MouseEvent) => {
    const clickedWordElement = getClickedSubtitleWordElement(event.target);
    if (!clickedWordElement) return;

    const clickedWordStart = getSubtitleWordStart(clickedWordElement);
    if (clickedWordStart === undefined) return;

    const clickedSegmentElement =
      getSubtitleSegmentElementFromWord(clickedWordElement);
    if (!clickedSegmentElement) return;

    const clickedSegmentIndex = getSubtitleSegmentElementIndex(
      clickedSegmentElement,
    );
    if (
      clickedSegmentIndex === undefined ||
      clickedSegmentIndex >= subtitleLength
    ) {
      return;
    }

    const frameIndex = getSeekFrameIndex(clickedWordStart);
    if (frameIndex === undefined) return;

    seek(frameIndex);
    controller.activate(clickedSegmentIndex, event.clientY);
  };

  element.addEventListener('click', handleClick);

  return {
    reset: controller.reset,
    dispose: () => {
      element.removeEventListener('click', handleClick);
      controller.dispose();
    },
  };
};
