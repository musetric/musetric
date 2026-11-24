import { afterEach, describe, expect, it } from 'vitest';
import { createSeekDrag } from '../seekDrag.js';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const touch = (type: string, clientX: number) =>
  new PointerEvent(type, {
    pointerId: 3,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY: 10,
    bubbles: true,
    cancelable: true,
  });

const open = () => {
  const element = document.createElement('div');
  element.style.cssText =
    'position: fixed; left: 0; top: 0; width: 400px; height: 40px;';
  Object.assign(element, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
  document.body.append(element);
  const taps: number[] = [];
  const updates: number[] = [];
  const drag = createSeekDrag({
    element,
    onUpdate: (event) => {
      updates.push(event.offsetRatio);
    },
    onTap: (ratio) => {
      taps.push(ratio);
    },
  });
  cleanups.push(() => {
    drag.dispose();
    element.remove();
  });
  return { element, taps, updates };
};

describe('the seek drag of the tracks', () => {
  it('seeks where a finger taps', () => {
    const { element, taps, updates } = open();
    element.dispatchEvent(touch('pointerdown', 100));
    element.dispatchEvent(touch('pointerup', 100));
    expect(taps).toEqual([0.25]);
    expect(updates).toEqual([]);
  });

  it('drags by a finger without a tap', () => {
    const { element, taps, updates } = open();
    element.dispatchEvent(touch('pointerdown', 100));
    element.dispatchEvent(touch('pointermove', 140));
    element.dispatchEvent(touch('pointermove', 200));
    element.dispatchEvent(touch('pointerup', 200));
    expect(taps).toEqual([]);
    expect(updates).toEqual([0, 0.15]);
  });
});
