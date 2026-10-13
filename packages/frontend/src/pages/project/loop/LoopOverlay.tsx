import { Box } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { subscribeVisualizationRender } from '../visualization/visualizationRender.js';
import { getXAtFrame } from './loopPointer.js';
import { subscribeLoopEdgeDrag } from './subscribeLoopEdgeDrag.js';
import { subscribeLoopGrabCursor } from './subscribeLoopGrabCursor.js';
import { subscribeLoopTapSeek } from './subscribeLoopTapSeek.js';

export const LoopOverlay: FC = () => {
  const stage = useEngineStore((state) => state.loopStage);
  const looping = stage !== undefined;
  const editable = stage === 'range';
  const rootRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const before = beforeRef.current;
    const after = afterRef.current;
    const fromEdge = fromRef.current;
    const toEdge = toRef.current;
    if (!root || !before || !after || !fromEdge || !toEdge) {
      return;
    }
    let { width } = root.getBoundingClientRect();

    const render = () => {
      const { range } = engine.store.get();
      if (!range) {
        return;
      }
      const from = getXAtFrame(range.fromFrame, width);
      const to = getXAtFrame(range.toFrame, width);
      before.style.width = `${Math.max(0, from)}px`;
      after.style.left = `${to}px`;
      fromEdge.style.transform = `translateX(${from}px)`;
      toEdge.style.transform = `translateX(${to}px)`;
    };

    render();
    const unsubscribeFrom = subscribeLoopEdgeDrag(fromEdge, 'from', root);
    const unsubscribeTo = subscribeLoopEdgeDrag(toEdge, 'to', root);
    const unsubscribeCursor = subscribeLoopGrabCursor(root);
    const unsubscribeTapSeek = subscribeLoopTapSeek(root);
    const unsubscribeRender = subscribeVisualizationRender({
      resizeTarget: root,
      onResize: () => {
        width = root.getBoundingClientRect().width;
        render();
      },
      render,
      engineKeys: ['frameIndex', 'range', 'viewWindow'],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });

    return () => {
      unsubscribeFrom();
      unsubscribeTo();
      unsubscribeCursor();
      unsubscribeTapSeek();
      unsubscribeRender();
    };
  }, [looping]);

  if (!looping) {
    return undefined;
  }

  const edgeSx = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -8,
    width: 16,
    cursor: 'ew-resize',
    touchAction: 'none',
    pointerEvents: editable ? 'auto' : 'none',
    willChange: 'transform',
    zIndex: 1,
  } as const;

  const dimSx = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    bgcolor: 'rgba(0, 0, 0, 0.55)',
  } as const;

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <Box ref={beforeRef} sx={{ ...dimSx, left: 0 }} />
      <Box ref={afterRef} sx={{ ...dimSx, right: 0 }} />
      {(['from', 'to'] as const).map((edge) => (
        <Box key={edge} ref={edge === 'from' ? fromRef : toRef} sx={edgeSx}>
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 7,
              width: 2,
              bgcolor: 'primary.main',
            }}
          />
          {editable && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 8,
                left: 0,
                width: 16,
                height: 28,
                borderRadius: 1.25,
                bgcolor: 'primary.main',
              }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
};
