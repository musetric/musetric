import { type GestureAxis } from './multiPointerGesture.js';
import { type ViewportState } from './viewportState.js';

const getRectAxisSize = (rect: DOMRect, axis: GestureAxis): number =>
  axis === 'x' ? rect.width : rect.height;

const getAxisCoordinate = (
  axis: GestureAxis,
  clientX: number,
  clientY: number,
): number => (axis === 'x' ? clientX : clientY);

const getAxisStart = (rect: DOMRect, axis: GestureAxis): number =>
  axis === 'x' ? rect.left : rect.top;

const getAxisRatio = (
  rect: DOMRect,
  axis: GestureAxis,
  coordinate: number,
): number | undefined => {
  const axisSize = getRectAxisSize(rect, axis);
  if (axisSize <= 0) return undefined;
  return (coordinate - getAxisStart(rect, axis)) / axisSize;
};

export const getViewportAxisSize = (
  element: HTMLElement,
  axis: GestureAxis,
): number => getRectAxisSize(element.getBoundingClientRect(), axis);

export const getViewportCoordinateAnchorRatio = (
  element: HTMLElement,
  state: ViewportState,
  axis: GestureAxis,
  coordinate: number,
): number | undefined => {
  if (state.kind === 'position') {
    return state.originRatio;
  }

  return getAxisRatio(element.getBoundingClientRect(), axis, coordinate);
};

export type ViewportPointAnchorRequest = {
  element: HTMLElement;
  state: ViewportState;
  axis: GestureAxis;
  clientX: number;
  clientY: number;
};

export const getViewportPointAnchorRatio = (
  request: ViewportPointAnchorRequest,
): number | undefined =>
  getViewportCoordinateAnchorRatio(
    request.element,
    request.state,
    request.axis,
    getAxisCoordinate(request.axis, request.clientX, request.clientY),
  );

export const getViewportDragZoomScale = (
  axis: GestureAxis,
  delta: number,
  zoomSensitivity: number,
): number => {
  if (axis === 'x') {
    return Math.exp(delta * zoomSensitivity);
  }

  return Math.exp(-delta * zoomSensitivity);
};
