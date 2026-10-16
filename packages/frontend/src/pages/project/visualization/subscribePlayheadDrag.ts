import { clampToRange } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { useSettingsStore } from '../settings/store.js';
import { getVisualizationView } from './visualizationView.js';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum));

type PlayheadDrag = {
  pointerId: number;
  viewStartFrame: number;
  viewFrameCount: number;
};

export const subscribePlayheadDrag = (
  handle: HTMLElement,
  area: HTMLElement,
): (() => void) => {
  const freeze = createInteractionFreeze();
  let drag: PlayheadDrag | undefined = undefined;

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    const { frameIndex, frameCount } = engine.store.get();
    if (!frameCount) return;
    event.stopPropagation();
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const { visibleTime, playheadRatio } = getVisualizationView();
    const viewFrameCount = visibleTime * engine.context.sampleRate;
    drag = {
      pointerId: event.pointerId,
      viewStartFrame: frameIndex - playheadRatio * viewFrameCount,
      viewFrameCount,
    };
    freeze.freeze();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    const { viewStartFrame, viewFrameCount } = drag;
    const { frameCount = 0, range, viewWindow } = engine.store.get();
    const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const frameIndex = Math.round(
      clampToRange(
        clamp(viewStartFrame + pointerRatio * viewFrameCount, 0, frameCount),
        range,
      ),
    );
    if (!viewWindow) {
      useSettingsStore
        .getState()
        .setPlayheadRatio((frameIndex - viewStartFrame) / viewFrameCount);
    }
    engine.player.seek(frameIndex, 'playhead');
  };

  const handlePointerEnd = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    freeze.release();
  };

  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerEnd);
  handle.addEventListener('pointercancel', handlePointerEnd);

  return () => {
    handle.removeEventListener('pointerdown', handlePointerDown);
    handle.removeEventListener('pointermove', handlePointerMove);
    handle.removeEventListener('pointerup', handlePointerEnd);
    handle.removeEventListener('pointercancel', handlePointerEnd);
    freeze.release();
  };
};
