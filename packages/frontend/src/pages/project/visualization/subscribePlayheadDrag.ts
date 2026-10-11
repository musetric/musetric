import { engine } from '../../../engine/engine.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { useSettingsStore } from '../settings/store.js';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum));

type PlayheadDrag = {
  pointerId: number;
  viewStartFrame: number;
};

export const subscribePlayheadDrag = (
  handle: HTMLElement,
  area: HTMLElement,
): (() => void) => {
  const freeze = createInteractionFreeze();
  let drag: PlayheadDrag | undefined = undefined;

  const visibleFrames = () =>
    useSettingsStore.getState().visibleTime * engine.context.sampleRate;

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    const { frameIndex, frameCount } = engine.store.get();
    if (!frameCount) return;
    event.stopPropagation();
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const { playheadRatio } = useSettingsStore.getState();
    drag = {
      pointerId: event.pointerId,
      viewStartFrame: frameIndex - playheadRatio * visibleFrames(),
    };
    freeze.freeze();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frames = visibleFrames();
    const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const frameIndex = Math.round(
      clamp(
        drag.viewStartFrame + pointerRatio * frames,
        0,
        engine.store.get().frameCount ?? 0,
      ),
    );
    useSettingsStore
      .getState()
      .setPlayheadRatio((frameIndex - drag.viewStartFrame) / frames);
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
