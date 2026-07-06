import {
  maximumSpectrogramFrequency,
  minimumSpectrogramFrequency,
  minimumSpectrogramFrequencyRatio,
} from '@musetric/spectrogram';
import {
  type ViewportPositionState,
  type ViewportRangeState,
  type ViewportState,
} from '@musetric/utils';
import { type GestureAxis } from '@musetric/utils/dom';

const logMinFrequency = Math.log(minimumSpectrogramFrequency);
const logMaxFrequency = Math.log(maximumSpectrogramFrequency);
const logMinRange = Math.log(minimumSpectrogramFrequencyRatio);
const logMaxRange = logMaxFrequency - logMinFrequency;

const minVisibleTime = 0.1;
const maxVisibleTime = 60;

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

export type SpectrogramGestureContext = {
  getSampleRate: () => number;
  getFrameCount: () => number;
  getFrameIndex: () => number;
  getVisibleTime: () => number;
  getPlayheadRatio: () => number;
  getMinFrequency: () => number;
  getMaxFrequency: () => number;
};

const readPositionState = (
  context: SpectrogramGestureContext,
): ViewportPositionState | undefined => {
  const frameCount = context.getFrameCount();
  if (!frameCount) return undefined;
  const sampleRate = context.getSampleRate();
  return {
    kind: 'position',
    position: context.getFrameIndex(),
    size: context.getVisibleTime() * sampleRate,
    originRatio: context.getPlayheadRatio(),
    minimumPosition: 0,
    maximumPosition: frameCount,
    minimumSize: minVisibleTime * sampleRate,
    maximumSize: maxVisibleTime * sampleRate,
    panDirection: -1,
  };
};

const readRangeState = (
  context: SpectrogramGestureContext,
): ViewportRangeState => ({
  kind: 'range',
  lower: Math.log(context.getMinFrequency()),
  upper: Math.log(context.getMaxFrequency()),
  minimumValue: logMinFrequency,
  maximumValue: logMaxFrequency,
  minimumSize: logMinRange,
  maximumSize: logMaxRange,
  panDirection: 1,
  reverse: true,
});

export const readSpectrogramViewportState = (
  context: SpectrogramGestureContext,
  axis: GestureAxis,
): ViewportState | undefined =>
  axis === 'x' ? readPositionState(context) : readRangeState(context);

export type SpectrogramViewportControls = {
  setVisibleTime: (visibleTime: number) => void;
  setFrequencyRange: (minFrequency: number, maxFrequency: number) => void;
  seek: (frameIndex: number) => void;
};

export const applySpectrogramViewportState = (
  context: SpectrogramGestureContext,
  controls: SpectrogramViewportControls,
  state: ViewportState,
) => {
  if (state.kind === 'position') {
    const sampleRate = context.getSampleRate();
    controls.setVisibleTime(state.size / sampleRate);
    controls.seek(state.position);
    return;
  }

  controls.setFrequencyRange(Math.exp(state.lower), Math.exp(state.upper));
};

export const getSpectrogramViewportAxisSize = (
  element: HTMLElement,
  axis: GestureAxis,
): number => getRectAxisSize(element.getBoundingClientRect(), axis);

export const getSpectrogramViewportCoordinateAnchorRatio = (
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

export type SpectrogramViewportPointAnchorRequest = {
  element: HTMLElement;
  state: ViewportState;
  axis: GestureAxis;
  clientX: number;
  clientY: number;
};

export const getSpectrogramViewportPointAnchorRatio = (
  request: SpectrogramViewportPointAnchorRequest,
): number | undefined =>
  getSpectrogramViewportCoordinateAnchorRatio(
    request.element,
    request.state,
    request.axis,
    getAxisCoordinate(request.axis, request.clientX, request.clientY),
  );

export const getSpectrogramDragZoomScale = (
  axis: GestureAxis,
  delta: number,
  zoomSensitivity: number,
): number => {
  if (axis === 'x') {
    return Math.exp(delta * zoomSensitivity);
  }

  return Math.exp(-delta * zoomSensitivity);
};
