import { Box } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from './visualizationRender.js';

export const VisualizationCursor: FC = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
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
      const { visualizationMode } = useProjectStore.getState();
      const waveformCursorRatio = frameCount ? frameIndex / frameCount : 0;
      const cursorRatio =
        visualizationMode === 'tracks' ? waveformCursorRatio : playheadRatio;
      const cursorX = alignPixel(
        cursorRatio * parentWidth,
        window.devicePixelRatio,
      );

      element.style.transform = `translateX(${cursorX}px)`;
    };

    const resize = () => {
      parentWidth = parentElement.getBoundingClientRect().width;
      render();
    };

    render();

    return subscribeVisualizationRender({
      resizeTarget: parentElement,
      onResize: resize,
      render,
      engineKeys: ['frameCount', 'frameIndex'],
      projectKeys: ['visualizationMode'],
      settingsKeys: ['playheadRatio'],
    });
  }, []);

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
    />
  );
};
