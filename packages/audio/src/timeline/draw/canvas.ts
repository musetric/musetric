import { assertDefined, createResourceCell } from '@musetric/utils';

export type TimelineCanvasState = {
  context: CanvasRenderingContext2D;
  height: number;
  observer: ResizeObserver;
  width: number;
};

export const createCanvasCell = () =>
  createResourceCell({
    create: (canvas: HTMLCanvasElement): TimelineCanvasState => {
      const context = assertDefined(
        canvas.getContext('2d'),
        'Context 2D not available on the timeline canvas',
      );

      const rect = canvas.getBoundingClientRect();
      const state: TimelineCanvasState = {
        context,
        height: Math.max(1, rect.height),
        observer: new ResizeObserver((entries) => {
          const [entry] = entries;
          const { width, height } = entry.contentRect;

          state.width = Math.max(1, width);
          state.height = Math.max(1, height);
        }),
        width: Math.max(1, rect.width),
      };
      state.observer.observe(canvas);

      return state;
    },
    dispose: (state) => {
      state.observer.disconnect();
    },
    equals: (current, next) => current === next,
  });
