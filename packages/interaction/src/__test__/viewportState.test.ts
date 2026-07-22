import { describe, expect, it } from 'vitest';
import { panViewportState, zoomViewportState } from '../viewportState.js';

describe('viewportState', () => {
  it('stops pan inertia when a position viewport reaches its boundary', () => {
    const result = panViewportState({
      state: {
        kind: 'position',
        position: 5,
        size: 100,
        originRatio: 0.5,
        minimumPosition: 0,
        maximumPosition: 10,
        minimumSize: 10,
        maximumSize: 200,
        panDirection: 1,
      },
      delta: 20,
      viewportSize: 100,
    });

    expect(result.clamped).toBe(true);
    expect(result.state).toMatchObject({ position: 10 });
  });

  it('keeps the zoom anchor fixed for reversed range viewports', () => {
    const result = zoomViewportState({
      state: {
        kind: 'range',
        lower: 0,
        upper: 10,
        minimumValue: 0,
        maximumValue: 20,
        minimumSize: 1,
        maximumSize: 20,
        panDirection: 1,
        reverse: true,
      },
      anchorRatio: 0.25,
      scale: 2,
    });

    expect(result.clamped).toBe(false);
    expect(result.state).toMatchObject({ lower: 3.75, upper: 8.75 });
  });
});
