import { createResourceCell } from '@musetric/resource-utils';

export type TimelineCanvasState = {
  context: CanvasRenderingContext2D;
};

export const createCanvasCell = () =>
  createResourceCell({
    create: (canvas: HTMLCanvasElement): TimelineCanvasState => {
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Context 2D not available on the timeline canvas');
      }

      return { context };
    },
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
