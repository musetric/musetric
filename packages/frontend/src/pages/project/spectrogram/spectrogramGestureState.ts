import { type ViewportState } from '@musetric/utils';
import { type GestureAxis } from '@musetric/utils/dom';
import {
  type SpectrogramGestureContext,
  type SpectrogramViewportControls,
} from './spectrogramGestureViewport.js';

export type SpectrogramGestureControls = SpectrogramViewportControls & {
  setFreeze: (freeze: boolean) => void;
};

export type SpectrogramGestureOptions = {
  element: HTMLElement;
  context: SpectrogramGestureContext;
  controls: SpectrogramGestureControls;
  zoomSensitivity?: number;
};

export type SpectrogramGesture = {
  abort: () => void;
  dispose: () => void;
};

export type ActivePan = {
  axis: GestureAxis;
  state: ViewportState;
};

export type ActiveZoom = {
  axis: GestureAxis;
  anchorRatio: number;
  startState: ViewportState;
};

export type ActivePinchZoom = ActiveZoom & {
  startSpread: number;
};

export type ActiveDragZoom = ActiveZoom & {
  totalDelta: number;
};

export type SpectrogramGestureMode =
  | 'idle'
  | 'pan'
  | 'pan-inertia'
  | 'pinch-zoom'
  | 'drag-zoom';
