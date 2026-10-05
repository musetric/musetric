import { Box } from '@mui/material';
import { type TimelineMode } from '@musetric/audio/timeline';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { subscribePlayheadDrag } from './subscribePlayheadDrag.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from './visualizationRender.js';

export type VisualizationCursorProps = {
  mode: TimelineMode;
};

export const VisualizationCursor: FC<VisualizationCursorProps> = (props) => {
  const { mode } = props;
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    const handle = handleRef.current;

    if (!element || !handle) {
      return;
    }

    const { parentElement } = element;

    if (!parentElement) {
      return;
    }

    let parentWidth = parentElement.getBoundingClientRect().width;

    const render = () => {
      const { frameCount, frameIndex } = engine.store.get();
      const { playheadRatio } = useSettingsStore.getState();
      const waveformCursorRatio = frameCount ? frameIndex / frameCount : 0;
      const cursorRatio =
        mode === 'tracks' ? waveformCursorRatio : playheadRatio;
      const cursorX = alignPixel(
        cursorRatio * parentWidth,
        window.devicePixelRatio,
      );

      element.style.transform = `translateX(${cursorX}px)`;
      handle.style.display = mode === 'tracks' ? 'none' : '';
    };

    const resize = () => {
      parentWidth = parentElement.getBoundingClientRect().width;
      render();
    };

    render();

    const unsubscribeDrag = subscribePlayheadDrag(handle, parentElement);
    const unsubscribeRender = subscribeVisualizationRender({
      resizeTarget: parentElement,
      onResize: resize,
      render,
      engineKeys: ['frameCount', 'frameIndex'],
      settingsKeys: ['playheadRatio'],
    });

    return () => {
      unsubscribeDrag();
      unsubscribeRender();
    };
  }, [mode]);

  return (
    <Box
      ref={ref}
      position='absolute'
      top={0}
      bottom={0}
      left={0}
      width='1px'
      sx={{
        backgroundColor: (theme) => theme.palette.primary.main,
        pointerEvents: 'none',
        willChange: 'transform',
        zIndex: 0,
      }}
    >
      <Box
        ref={handleRef}
        position='absolute'
        top={0}
        bottom={0}
        left='50%'
        width={{ xs: '32px', md: '16px' }}
        sx={{
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          touchAction: 'none',
          transform: 'translateX(-50%)',
        }}
      />
    </Box>
  );
};
