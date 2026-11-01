import { clampToRange } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { playHaptic } from '../haptics.js';
import { useSettingsStore } from '../settings/store.js';
import { getVisualizationView } from './visualizationView.js';

const longPressMs = 350;
const pressSlop = 6;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum));

const isInside = (element: HTMLElement, event: PointerEvent): boolean => {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
};

type PlayheadDrag = {
  pointerId: number;
  viewStartFrame: number;
  viewFrameCount: number;
  atEdge: boolean;
};

type PlayheadPress = {
  pointerId: number;
  clientX: number;
  clientY: number;
  timer: ReturnType<typeof setTimeout>;
};

export const subscribePlayheadDrag = (
  handle: HTMLElement,
  area: HTMLElement,
  onActiveChange: (active: boolean) => void,
): (() => void) => {
  const freeze = createInteractionFreeze();
  let drag: PlayheadDrag | undefined = undefined;
  let press: PlayheadPress | undefined = undefined;
  let listening: AbortController | undefined = undefined;

  const begin = (pointerId: number): boolean => {
    const { frameIndex, frameCount } = engine.store.get();
    if (!frameCount) return false;
    const { visibleTime, playheadRatio } = getVisualizationView();
    const viewFrameCount = visibleTime * engine.context.sampleRate;
    drag = {
      pointerId,
      viewStartFrame: frameIndex - playheadRatio * viewFrameCount,
      viewFrameCount,
      atEdge: false,
    };
    freeze.freeze();
    onActiveChange(true);
    return true;
  };

  const finish = () => {
    if (press) {
      clearTimeout(press.timer);
      press = undefined;
    }
    listening?.abort();
    listening = undefined;
    if (!drag) return;
    if (handle.hasPointerCapture(drag.pointerId)) {
      handle.releasePointerCapture(drag.pointerId);
    }
    drag = undefined;
    freeze.release();
    onActiveChange(false);
  };

  const seekTo = (event: PointerEvent, active: PlayheadDrag) => {
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    const { viewStartFrame, viewFrameCount } = active;
    const { frameCount = 0, range, viewWindow } = engine.store.get();
    const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const frameIndex = Math.round(
      clampToRange(
        clamp(viewStartFrame + pointerRatio * viewFrameCount, 0, frameCount),
        range,
      ),
    );
    const atEdge =
      frameIndex <= (range?.fromFrame ?? 0) ||
      frameIndex >= (range ? range.toFrame - 1 : frameCount);
    if (atEdge && !active.atEdge) {
      playHaptic('detent');
    }
    active.atEdge = atEdge;
    if (!viewWindow) {
      useSettingsStore
        .getState()
        .setPlayheadRatio((frameIndex - viewStartFrame) / viewFrameCount);
    }
    engine.player.seek(frameIndex, 'playhead');
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      event.stopPropagation();
      event.preventDefault();
      seekTo(event, drag);
      return;
    }
    if (press?.pointerId !== event.pointerId) return;
    const moved = Math.hypot(
      event.clientX - press.clientX,
      event.clientY - press.clientY,
    );
    if (moved >= pressSlop) {
      finish();
    }
  };

  const handlePointerEnd = (event: PointerEvent) => {
    if (
      drag?.pointerId === event.pointerId ||
      press?.pointerId === event.pointerId
    ) {
      finish();
    }
  };

  const listen = () => {
    listening = new AbortController();
    const options = { capture: true, signal: listening.signal };
    window.addEventListener('pointermove', handlePointerMove, options);
    window.addEventListener('pointerup', handlePointerEnd, options);
    window.addEventListener('pointercancel', handlePointerEnd, options);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || !isInside(handle, event)) {
      return;
    }
    finish();
    if (event.pointerType === 'mouse') {
      if (!begin(event.pointerId)) return;
      event.stopPropagation();
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      listen();
      return;
    }
    const { pointerId, clientX, clientY } = event;
    press = {
      pointerId,
      clientX,
      clientY,
      timer: setTimeout(() => {
        press = undefined;
        if (!begin(pointerId)) {
          finish();
          return;
        }
        playHaptic('grab');
      }, longPressMs),
    };
    listen();
  };

  area.addEventListener('pointerdown', handlePointerDown, { capture: true });

  return () => {
    area.removeEventListener('pointerdown', handlePointerDown, {
      capture: true,
    });
    finish();
  };
};
