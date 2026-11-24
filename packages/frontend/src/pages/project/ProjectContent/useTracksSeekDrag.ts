import { createSeekDrag } from '@musetric/interaction';
import { createNumberLimit } from '@musetric/utils';
import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeForeignSeek } from '../../../engine/foreignSeek.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { playHaptic } from '../haptics.js';

export const useTracksSeekDrag = (
  elementRef: RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const freeze = createInteractionFreeze();
    let startFrameIndex = 0;
    let pinned = false;

    const drag = createSeekDrag({
      element,
      onStart: () => {
        pinned = false;
        freeze.freeze();
        startFrameIndex = engine.position.read();
      },
      onUpdate: (event) => {
        const { frameCount } = engine.store.get();
        if (!frameCount) {
          event.stop();
          return;
        }

        const frameIndex =
          event.pointerType !== 'touch'
            ? event.ratio * frameCount
            : startFrameIndex + event.offsetRatio * frameCount;
        const frameLimit = createNumberLimit({
          minimum: 0,
          maximum: frameCount,
        });

        const clamped = frameLimit.clamp(Math.round(frameIndex));
        const atEdge = clamped <= 0 || clamped >= frameCount;
        if (atEdge && !pinned) {
          playHaptic('detent');
        }
        pinned = atEdge;
        engine.player.seek(clamped, 'tracksVisualization');
      },
      onCancel: () => {
        engine.player.seek(startFrameIndex, 'tracksVisualization');
      },
      onEnd: () => {
        freeze.release();
      },
    });

    const unsubscribeSeek = subscribeForeignSeek('tracksVisualization', () => {
      drag.stop();
    });

    return () => {
      unsubscribeSeek();
      drag.dispose();
      freeze.release();
    };
  }, [elementRef]);
};
