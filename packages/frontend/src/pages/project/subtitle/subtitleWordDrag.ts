import { type api } from '@musetric/api';
import { engine } from '../../../engine/engine.js';
import { moveLoop, previewLoop } from '../loop/loopActions.js';
import {
  getLoopForWords,
  isSameWord,
  type SubtitleWordRef,
} from '../loop/loopRange.js';
import { createSubtitleEdgeScroll } from './subtitleEdgeScroll.js';
import {
  findSubtitleWordAt,
  findSubtitleWordFromTarget,
} from './subtitleWordHit.js';

const longPressMs = 350;
const dragSlop = 6;
const clickBlockMs = 400;

const findTouch = (touches: TouchList, identifier: number | undefined) =>
  Array.from(touches).find((touch) => touch.identifier === identifier);

export type SubtitleWordDrag = {
  isActive: () => boolean;
  dispose: () => void;
};

type Press = {
  pointerId: number;
  pointerType: string;
  touchId?: number;
  clientX: number;
  clientY: number;
  anchor: SubtitleWordRef;
  timer?: ReturnType<typeof setTimeout>;
};

type Drag = {
  pointerId: number;
  locked: boolean;
  touchId?: number;
  touchSeen: boolean;
  clientX: number;
  clientY: number;
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

  const select = () => {
    if (!drag) {
      return;
    }
    const current = findSubtitleWordAt(element, drag.clientX, drag.clientY);
    if (current && !isSameWord(current, drag.current)) {
      drag.current = current;
      previewLoop(getRange(drag));
    }
  };

  const edgeScroll = createSubtitleEdgeScroll(element, select);

  const clearPress = () => {
    clearTimeout(press?.timer);
    press = undefined;
  };

  const stopListening = () => {
    listening?.abort();
    listening = undefined;
  };

  const blockNextClick = () => {
    const controller = new AbortController();
    element.addEventListener(
      'click',
      (event) => {
        event.stopImmediatePropagation();
        event.preventDefault();
        controller.abort();
      },
      { capture: true, signal: controller.signal },
    );
    setTimeout(() => {
      controller.abort();
    }, clickBlockMs);
  };

  const start = () => {
    if (!press) {
      return;
    }
    const { pointerId, pointerType, touchId, clientX, clientY, anchor } = press;
    clearPress();
    if (engine.store.get().loopStage === 'sing') {
      return;
    }
    const locked = pointerType !== 'mouse';
    drag = {
      pointerId,
      locked,
      touchId,
      touchSeen: false,
      clientX,
      clientY,
      anchor,
      current: anchor,
    };
    if (locked) {
      element.style.overflow = 'hidden';
    }
    previewLoop(getRange(drag));
  };

  const moveTo = (clientX: number, clientY: number) => {
    if (!drag) {
      return;
    }
    drag.clientX = clientX;
    drag.clientY = clientY;
    edgeScroll.move(clientY);
    select();
  };

  const finish = () => {
    if (!drag) {
      return;
    }
    const range = getRange(drag);
    if (drag.locked) {
      element.style.overflow = '';
    }
    drag = undefined;
    edgeScroll.stop();
    stopListening();
    moveLoop(range);
    blockNextClick();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag) {
      if (drag.pointerId === event.pointerId) {
        moveTo(event.clientX, event.clientY);
      }
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
      moveTo(event.clientX, event.clientY);
      return;
    }
    clearPress();
    stopListening();
  };

  const handlePointerEnd = (event: PointerEvent) => {
    if (drag) {
      const cancelledWhileTouching =
        event.type === 'pointercancel' && drag.touchSeen;
      if (drag.pointerId === event.pointerId && !cancelledWhileTouching) {
        finish();
      }
      return;
    }
    if (press?.pointerId === event.pointerId) {
      clearPress();
      stopListening();
    }
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!drag) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const touch = findTouch(event.changedTouches, drag.touchId);
    if (touch) {
      drag.touchSeen = true;
      moveTo(touch.clientX, touch.clientY);
    }
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (drag) {
      if (findTouch(event.changedTouches, drag.touchId)) {
        finish();
      }
      return;
    }
    if (press && findTouch(event.changedTouches, press.touchId)) {
      clearPress();
      stopListening();
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    finish();
    const anchor = findSubtitleWordFromTarget(
      event.target,
      event.clientX,
      event.clientY,
    );
    if (!anchor) {
      return;
    }
    clearPress();
    press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
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
    document.addEventListener('pointerup', handlePointerEnd, { signal });
    document.addEventListener('pointercancel', handlePointerEnd, { signal });
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (
      press &&
      press.touchId === undefined &&
      event.changedTouches.length > 0
    ) {
      press.touchId = event.changedTouches[0].identifier;
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    if (drag || press) {
      event.preventDefault();
    }
  };

  const lifecycle = new AbortController();
  window.addEventListener('blur', finish, { signal: lifecycle.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        finish();
      }
    },
    { signal: lifecycle.signal },
  );
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: false });
  element.addEventListener('touchend', handleTouchEnd);
  element.addEventListener('touchcancel', handleTouchEnd);
  element.addEventListener('scroll', select, { passive: true });
  element.addEventListener('contextmenu', handleContextMenu);

  return {
    isActive: () => drag !== undefined,
    dispose: () => {
      lifecycle.abort();
      clearPress();
      stopListening();
      edgeScroll.stop();
      if (drag?.locked) {
        element.style.overflow = '';
      }
      drag = undefined;
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchEnd);
      element.removeEventListener('scroll', select);
      element.removeEventListener('contextmenu', handleContextMenu);
    },
  };
};
