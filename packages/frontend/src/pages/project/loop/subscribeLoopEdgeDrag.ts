import { type EngineRange } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { playHaptic } from '../haptics.js';
import { moveLoop } from './loopActions.js';
import { createLoopEdgePush } from './loopEdgePush.js';
import { getLoopPointerFrame } from './loopPointer.js';
import {
  getLoopEdgePreview,
  type LoopEdge,
  minLoopSeconds,
} from './loopRange.js';

const moveEdge = (
  range: EngineRange,
  edge: LoopEdge,
  frame: number,
): EngineRange => {
  const { sampleRate } = engine.context;
  const { frameCount = 0 } = engine.store.get();
  const minFrames = minLoopSeconds * sampleRate;
  if (edge === 'to') {
    return {
      ...range,
      toFrame: Math.round(
        Math.min(frameCount, Math.max(range.fromFrame + minFrames, frame)),
      ),
    };
  }
  const fromFrame = Math.round(
    Math.max(0, Math.min(range.toFrame - minFrames, frame)),
  );
  return { ...range, fromFrame };
};

export const subscribeLoopEdgeDrag = (
  element: HTMLElement,
  edge: LoopEdge,
  area: HTMLElement,
): (() => void) => {
  let dragging = false;
  let pinned = false;
  const moveTo = (clientX: number) => {
    const { range } = engine.store.get();
    if (!range) {
      return;
    }
    const frame = getLoopPointerFrame(area, clientX);
    const moved = moveEdge(range, edge, frame);
    const reached =
      (edge === 'to' ? moved.toFrame : moved.fromFrame) !== Math.round(frame);
    if (reached && !pinned) {
      playHaptic('detent');
    }
    pinned = reached;
    engine.player.setRange(moved);
  };
  const push = createLoopEdgePush(area, 'widen', moveTo);
  const handlePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (engine.store.get().loopStage !== 'range') {
      return;
    }
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    dragging = true;
    pinned = false;
    playHaptic('grab');
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    push.move(event.clientX);
    moveTo(event.clientX);
  };
  const handlePointerUp = () => {
    push.stop();
    const { range } = engine.store.get();
    if (dragging && range) {
      moveLoop(
        range,
        getLoopEdgePreview(range, edge, engine.context.sampleRate),
      );
    }
    dragging = false;
  };
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerUp);
  return () => {
    push.stop();
    element.removeEventListener('pointerdown', handlePointerDown);
    element.removeEventListener('pointermove', handlePointerMove);
    element.removeEventListener('pointerup', handlePointerUp);
    element.removeEventListener('pointercancel', handlePointerUp);
  };
};
