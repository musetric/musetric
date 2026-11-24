import { afterEach, describe, expect, it } from 'vitest';
import { createViewportGesture } from '../viewportGesture.js';
import {
  type ViewportPositionState,
  type ViewportState,
} from '../viewportState.js';

const longPressMs = 400;

const startState: ViewportPositionState = {
  kind: 'position',
  position: 48_000,
  size: 96_000,
  originRatio: 0.25,
  minimumPosition: 0,
  maximumPosition: 480_000,
  minimumSize: 4800,
  maximumSize: 960_000,
  panDirection: -1,
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

type Recorded = {
  applied: ViewportState[];
  frozen: boolean[];
  taps: number[];
};

const open = () => {
  const element = document.createElement('div');
  element.style.width = '400px';
  element.style.height = '200px';
  Object.assign(element, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
  document.body.append(element);
  const recorded: Recorded = { applied: [], frozen: [], taps: [] };
  const gesture = createViewportGesture({
    element,
    readState: (axis) => (axis === 'x' ? startState : undefined),
    applyState: (state) => {
      recorded.applied.push(state);
    },
    setFreeze: (frozen) => {
      recorded.frozen.push(frozen);
    },
    onTap: (clientX) => {
      recorded.taps.push(clientX);
    },
    readWheelAnchorRatio: () => startState.originRatio,
  });
  cleanups.push(() => {
    gesture.dispose();
    element.remove();
  });
  return { element, recorded };
};

const pointer = (type: string, clientX: number) =>
  new PointerEvent(type, {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY: 100,
    bubbles: true,
    cancelable: true,
  });

const wait = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('the viewport gesture', () => {
  it('zooms by the wheel around the given anchor without holding', () => {
    const { element, recorded } = open();
    element.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -200,
        shiftKey: true,
        clientX: 300,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(recorded.frozen).toEqual([]);
    expect(recorded.applied).toHaveLength(1);
    const [zoomed] = recorded.applied;
    expect(zoomed).toMatchObject({ kind: 'position', position: 48_000 });
    expect(zoomed.kind === 'position' && zoomed.size).toBeLessThan(
      startState.size,
    );
  });

  it('holds from the press, reports a tap and releases', () => {
    const { element, recorded } = open();
    element.dispatchEvent(pointer('pointerdown', 120));
    expect(recorded.frozen).toEqual([true]);
    element.dispatchEvent(pointer('pointerup', 121));
    expect(recorded.taps).toEqual([121]);
    expect(recorded.frozen).toEqual([true, false]);
  });

  it('takes a long press for a hold, not a tap', async () => {
    const { element, recorded } = open();
    element.dispatchEvent(pointer('pointerdown', 120));
    await wait(longPressMs);
    element.dispatchEvent(pointer('pointerup', 120));
    expect(recorded.taps).toEqual([]);
    expect(recorded.frozen).toEqual([true, false]);
  });
});
