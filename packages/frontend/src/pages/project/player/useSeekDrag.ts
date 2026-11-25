import { type EngineSeekOrigin } from '@musetric/engine';
import { createPointerDrag } from '@musetric/interaction';
import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeForeignSeek } from '../../../engine/foreignSeek.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { playHaptic } from '../haptics.js';

const touchLockDistance = 8;

export const useSeekDrag = (
  elementRef: RefObject<HTMLElement | null>,
  origin: EngineSeekOrigin,
  disabled: boolean,
) => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element || disabled) return;

    const freeze = createInteractionFreeze();
    const drag = createPointerDrag(element, (press) => {
      const { frameCount } = engine.store.get();
      if (!frameCount) return undefined;
      freeze.freeze();
      const startFrame = engine.position.read();
      const relative = press.pointerType === 'touch';
      let lockX: number | undefined = undefined;
      let pinned = false;

      const seekAt = (clientX: number) => {
        const { left, width } = element.getBoundingClientRect();
        const frameIndex =
          lockX === undefined
            ? ((clientX - left) / width) * frameCount
            : startFrame + ((clientX - lockX) / width) * frameCount;
        const clamped = Math.min(
          Math.max(Math.round(frameIndex), 0),
          frameCount,
        );
        const atEdge = clamped <= 0 || clamped >= frameCount;
        if (atEdge && !pinned) {
          playHaptic('detent');
        }
        pinned = atEdge;
        engine.player.seek(clamped, origin);
      };

      if (!relative) {
        seekAt(press.clientX);
      }
      return {
        move: (event) => {
          if (relative && lockX === undefined) {
            if (Math.abs(event.clientX - press.clientX) < touchLockDistance) {
              return;
            }
            lockX = event.clientX;
          }
          seekAt(event.clientX);
        },
        end: freeze.release,
        cancel: () => {
          engine.player.seek(startFrame, origin);
          freeze.release();
        },
      };
    });

    const unsubscribeSeek = subscribeForeignSeek(origin, drag.stop);

    return () => {
      unsubscribeSeek();
      drag.dispose();
    };
  }, [elementRef, origin, disabled]);
};
