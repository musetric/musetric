import { createSeekDrag } from '@musetric/interaction';
import { createNumberLimit } from '@musetric/utils';
import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeForeignSeek } from '../../../engine/foreignSeek.js';

export const useTracksSeekDrag = (
  elementRef: RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let startFrameIndex = 0;
    let releaseFrozenOnEnd = true;

    const drag = createSeekDrag({
      element,
      onStart: () => {
        releaseFrozenOnEnd = true;
        engine.player.setFrozen(true);
        startFrameIndex = engine.store.get().frameIndex;
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

        engine.player.seek(
          frameLimit.clamp(Math.round(frameIndex)),
          'tracksVisualization',
        );
      },
      onEnd: () => {
        if (releaseFrozenOnEnd) {
          engine.player.setFrozen(false);
        }
        releaseFrozenOnEnd = true;
      },
    });

    const unsubscribeSeek = subscribeForeignSeek('tracksVisualization', () => {
      releaseFrozenOnEnd = false;
      drag.stop();
    });

    return () => {
      unsubscribeSeek();
      drag.dispose();
      engine.player.setFrozen(false);
    };
  }, [elementRef]);
};
