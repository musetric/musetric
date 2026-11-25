import { createFollowScrollController } from '@musetric/interaction';
import { type SubtitleCursor } from './subtitleCursor.js';

const subtitleSegmentIndexAttribute = 'data-subtitle-segment-index';
const subtitleWordStartAttribute = 'data-subtitle-word-start';
const subtitleLoopEdgeSelector = '[data-subtitle-loop-edge]';

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

const getClickedSubtitleWordElement = (event: MouseEvent) => {
  const targetElement = getEventTargetElement(event.target);
  if (!targetElement) return undefined;
  const selector = `[${subtitleWordStartAttribute}]`;
  if (targetElement.closest(subtitleLoopEdgeSelector)) {
    return document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.closest(selector))
      ?.closest<HTMLElement>(selector);
  }
  return targetElement.closest<HTMLElement>(selector);
};

const getSubtitleWordStart = (wordElement: HTMLElement) => {
  const wordStart = wordElement.dataset.subtitleWordStart;
  return wordStart === undefined ? undefined : Number(wordStart);
};

type Unsubscribe = () => void;

export type SubtitleFollowControllerOptions = {
  element: HTMLDivElement;
  cursor: SubtitleCursor;
  subscribeSeek: (callback: () => void) => Unsubscribe;
  isMoving: () => boolean;
  seekWord: (wordStart: number) => void;
};

export type SubtitleFollowController = {
  reset: () => void;
  showActive: () => void;
  dispose: () => void;
};

export const createSubtitleFollowController = (
  options: SubtitleFollowControllerOptions,
): SubtitleFollowController => {
  const { element, cursor, subscribeSeek, isMoving, seekWord } = options;

  const controller = createFollowScrollController({
    element,
    getActiveIndex: () => cursor.getActiveSegmentIndex(),
    subscribeActiveIndex: cursor.subscribeActiveSegmentIndex,
    subscribeSeek,
    locateElement: (index) => getSubtitleSegmentElement(element, index),
    isMoving,
  });

  const handleClick = (event: MouseEvent) => {
    const clickedWordElement = getClickedSubtitleWordElement(event);
    if (!clickedWordElement) return;

    const clickedWordStart = getSubtitleWordStart(clickedWordElement);
    if (clickedWordStart === undefined) return;

    seekWord(clickedWordStart);
  };

  element.addEventListener('click', handleClick);

  return {
    reset: controller.reset,
    showActive: controller.showActive,
    dispose: () => {
      element.removeEventListener('click', handleClick);
      controller.dispose();
    },
  };
};
