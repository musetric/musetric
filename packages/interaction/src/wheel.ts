export type WheelAxis = 'x' | 'y';

export type ResolveWheelAxis = (event: WheelEvent) => WheelAxis | undefined;

const defaultResolveAxis: ResolveWheelAxis = (event) => {
  if (event.shiftKey) return 'x';
  if (event.ctrlKey || event.metaKey) return 'y';
  return undefined;
};

const defaultLinePixels = 16;
const defaultPagePixels = 400;

const resolveWheelDelta = (
  event: WheelEvent,
  linePixels: number,
  pagePixels: number,
): number => {
  if (event.deltaMode === 1) return event.deltaY * linePixels;
  if (event.deltaMode === 2) return event.deltaY * pagePixels;
  return event.deltaY;
};

export type CreateWheelHandlerOptions = {
  resolveAxis?: ResolveWheelAxis;
  linePixels?: number;
  pagePixels?: number;
};

export type WheelHandler = {
  dispose: () => void;
};

export type WheelUpdate = {
  axis: WheelAxis;
  delta: number;
  clientX: number;
  clientY: number;
};

export const createWheelHandler = (
  element: HTMLElement,
  onWheel: (update: WheelUpdate) => void,
  options: CreateWheelHandlerOptions = {},
): WheelHandler => {
  const resolveAxis = options.resolveAxis ?? defaultResolveAxis;
  const linePixels = options.linePixels ?? defaultLinePixels;
  const pagePixels = options.pagePixels ?? defaultPagePixels;

  const handleWheel = (event: WheelEvent) => {
    const axis = resolveAxis(event);
    if (axis === undefined) return;
    event.preventDefault();
    onWheel({
      axis,
      delta: resolveWheelDelta(event, linePixels, pagePixels),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  element.addEventListener('wheel', handleWheel, { passive: false });

  return {
    dispose: () => {
      element.removeEventListener('wheel', handleWheel);
    },
  };
};
