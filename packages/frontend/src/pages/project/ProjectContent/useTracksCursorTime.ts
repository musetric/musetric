import { type RefObject, useEffect } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';
import { engine } from '../../../engine/engine.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from '../visualization/visualizationRender.js';

export const playedWidthVariable = '--tracks-played-width';

export const useTracksCursorTime = (
  lanesRef: RefObject<HTMLDivElement | null>,
  timeRef: RefObject<HTMLSpanElement | null>,
) => {
  useEffect(() => {
    const lanes = lanesRef.current;
    const time = timeRef.current;
    if (!lanes || !time) return;

    let lanesWidth = lanes.getBoundingClientRect().width;
    let timeWidth = 0;

    const render = () => {
      const { frameCount, frameIndex, duration } = engine.store.get();
      const ratio = frameCount ? frameIndex / frameCount : 0;
      const cursorX = alignPixel(ratio * lanesWidth, window.devicePixelRatio);
      lanes.style.setProperty(playedWidthVariable, `${cursorX}px`);

      const text = formatDuration(ratio * duration);
      if (time.textContent !== text) {
        time.textContent = text;
        timeWidth = time.offsetWidth;
      }
      const left = Math.max(
        0,
        Math.min(cursorX - timeWidth / 2, lanesWidth - timeWidth),
      );
      time.style.transform = `translateX(${left}px)`;
    };

    render();

    return subscribeVisualizationRender({
      resizeTarget: lanes,
      onResize: () => {
        lanesWidth = lanes.getBoundingClientRect().width;
        timeWidth = time.offsetWidth;
        render();
      },
      render,
      engineKeys: ['duration', 'frameCount', 'frameIndex'],
      settingsKeys: [],
    });
  }, [lanesRef, timeRef]);
};
