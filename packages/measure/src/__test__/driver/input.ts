import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { type MeasureInput } from '../measureInput.js';
import { type DeviceKind } from './device.js';

const moveMs = 16;
const tapMs = 60;

export const measureInputSchema: z.ZodType<MeasureInput> = z.union([
  z.object({
    kind: z.literal('swipe'),
    fromX: z.number(),
    toX: z.number(),
    y: z.number(),
    durationMs: z.number(),
  }),
  z.object({ kind: z.literal('tap'), x: z.number(), y: z.number() }),
]);

export type CdpSend = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

type Point = { x: number; y: number };

type Pointer = {
  down: (point: Point) => Promise<unknown>;
  move: (point: Point) => Promise<unknown>;
  up: (point: Point) => Promise<unknown>;
};

const createTouch = (send: CdpSend): Pointer => ({
  down: async (point) =>
    send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    }),
  move: async (point) =>
    send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point],
    }),
  up: async () =>
    send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
});

const createMouse = (send: CdpSend): Pointer => ({
  down: async (point) =>
    send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    }),
  move: async (point) =>
    send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
      button: 'left',
      buttons: 1,
    }),
  up: async (point) =>
    send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    }),
});

export const createPageInput = (send: CdpSend, kind: DeviceKind) => {
  const pointer = kind === 'android' ? createTouch(send) : createMouse(send);
  return async (input: MeasureInput) => {
    if (input.kind === 'tap') {
      const point = { x: input.x, y: input.y };
      await pointer.down(point);
      await setTimeout(tapMs);
      await pointer.up(point);
      return;
    }
    const steps = Math.max(1, Math.round(input.durationMs / moveMs));
    await pointer.down({ x: input.fromX, y: input.y });
    let point = { x: input.fromX, y: input.y };
    for (let step = 1; step <= steps; step += 1) {
      await setTimeout(input.durationMs / steps);
      point = {
        x: input.fromX + ((input.toX - input.fromX) * step) / steps,
        y: input.y,
      };
      await pointer.move(point);
    }
    await pointer.up(point);
  };
};
