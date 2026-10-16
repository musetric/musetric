import { type api } from '@musetric/api';
import { engine } from '../../../engine/engine.js';
import { moveLoop, previewLoop } from '../loop/loopActions.js';
import {
  getLoopForWords,
  isSameWord,
  type SubtitleWordRef,
} from '../loop/loopRange.js';

const longPressMs = 350;
const dragSlop = 6;

const getWordRef = (
  target: EventTarget | null,
): SubtitleWordRef | undefined => {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const word = target.closest<HTMLElement>('[data-subtitle-word-index]');
  const segment = word?.closest<HTMLElement>('[data-subtitle-segment-index]');
  if (!word || !segment) {
    return undefined;
  }
  return {
    segmentIndex: Number(segment.dataset.subtitleSegmentIndex),
    wordIndex: Number(word.dataset.subtitleWordIndex),
  };
};

const blockClick = (event: MouseEvent) => {
  event.stopImmediatePropagation();
  event.preventDefault();
};

export type SubtitleWordDrag = {
  isActive: () => boolean;
  dispose: () => void;
};

type Press = {
  pointerId: number;
  clientX: number;
  clientY: number;
  anchor: SubtitleWordRef;
  timer?: ReturnType<typeof setTimeout>;
};

type Drag = {
  pointerId: number;
  anchor: SubtitleWordRef;
  current: SubtitleWordRef;
};

export const createSubtitleWordDrag = (
  element: HTMLElement,
  subtitle: readonly api.subtitle.Segment[],
): SubtitleWordDrag => {
  let press: Press | undefined = undefined;
  let drag: Drag | undefined = undefined;
  let listening: AbortController | undefined = undefined;

  const getRange = (value: Drag) =>
    getLoopForWords(subtitle, value.anchor, value.current, {
      ...engine.store.get(),
      sampleRate: engine.context.sampleRate,
    });

  const clearPress = () => {
    clearTimeout(press?.timer);
    press = undefined;
  };

  const start = () => {
    if (!press) {
      return;
    }
    const { pointerId, anchor } = press;
    clearPress();
    if (engine.store.get().loopStage === 'sing') {
      return;
    }
    drag = { pointerId, anchor, current: anchor };
    previewLoop(getRange(drag));
  };

  const follow = (event: PointerEvent) => {
    if (!drag) {
      return;
    }
    const current = getWordRef(
      document.elementFromPoint(event.clientX, event.clientY),
    );
    if (current && !isSameWord(current, drag.current)) {
      drag.current = current;
      previewLoop(getRange(drag));
    }
  };

  const blockNextClick = () => {
    element.addEventListener('click', blockClick, { capture: true });
    setTimeout(() => {
      element.removeEventListener('click', blockClick, { capture: true });
    });
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      follow(event);
      return;
    }
    if (
      press?.pointerId !== event.pointerId ||
      Math.hypot(
        event.clientX - press.clientX,
        event.clientY - press.clientY,
      ) <= dragSlop
    ) {
      return;
    }
    if (press.timer === undefined) {
      start();
      follow(event);
    } else {
      clearPress();
    }
  };

  const stopListening = () => {
    listening?.abort();
    listening = undefined;
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      const range = getRange(drag);
      drag = undefined;
      moveLoop(range);
      blockNextClick();
    } else if (press?.pointerId !== event.pointerId) {
      return;
    }
    clearPress();
    stopListening();
  };

  const handlePointerDown = (event: PointerEvent) => {
    const anchor = getWordRef(event.target);
    if (!anchor || !event.isPrimary || event.button !== 0) {
      return;
    }
    clearPress();
    press = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      anchor,
      timer:
        event.pointerType === 'mouse'
          ? undefined
          : setTimeout(start, longPressMs),
    };
    stopListening();
    listening = new AbortController();
    const { signal } = listening;
    document.addEventListener('pointermove', handlePointerMove, { signal });
    document.addEventListener('pointerup', handlePointerUp, { signal });
    document.addEventListener('pointercancel', handlePointerUp, { signal });
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (drag) {
      event.preventDefault();
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    if (drag || press) {
      event.preventDefault();
    }
  };

  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('touchmove', handleTouchMove, { passive: false });
  element.addEventListener('contextmenu', handleContextMenu);

  return {
    isActive: () => drag !== undefined,
    dispose: () => {
      clearPress();
      stopListening();
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('contextmenu', handleContextMenu);
    },
  };
};
