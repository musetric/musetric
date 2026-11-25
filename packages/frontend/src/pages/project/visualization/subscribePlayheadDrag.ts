import { clampToRange } from '@musetric/engine';
import { createPointerDrag } from '@musetric/interaction';
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
  viewStartFrame: number;
  viewFrameCount: number;
  atEdge: boolean;
};

export const subscribePlayheadDrag = (
  handle: HTMLElement,
  area: HTMLElement,
  onActiveChange: (active: boolean) => void,
): (() => void) => {
  const freeze = createInteractionFreeze();

  const begin = (): PlayheadDrag | undefined => {
    if (!engine.store.get().frameCount) return undefined;
    const { visibleTime, playheadRatio } = getVisualizationView();
    const viewFrameCount = visibleTime * engine.context.sampleRate;
    freeze.freeze();
    onActiveChange(true);
    return {
      viewStartFrame: engine.position.read() - playheadRatio * viewFrameCount,
      viewFrameCount,
      atEdge: false,
    };
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

  const drag = createPointerDrag(area, (press) => {
    if (!isInside(handle, press)) return undefined;
    let active: PlayheadDrag | undefined = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    if (press.pointerType === 'mouse') {
      active = begin();
      if (!active) return undefined;
      press.stopPropagation();
      handle.setPointerCapture(press.pointerId);
    } else {
      timer = setTimeout(() => {
        active = begin();
        if (active) {
          playHaptic('grab');
        }
      }, longPressMs);
    }
    const finish = () => {
      clearTimeout(timer);
      if (!active) return;
      freeze.release();
      onActiveChange(false);
    };
    return {
      move: (event) => {
        if (active) {
          event.stopPropagation();
          seekTo(event, active);
          return;
        }
        const moved = Math.hypot(
          event.clientX - press.clientX,
          event.clientY - press.clientY,
        );
        if (moved >= pressSlop) {
          clearTimeout(timer);
        }
      },
      end: finish,
      cancel: finish,
    };
  });

  return drag.dispose;
};
