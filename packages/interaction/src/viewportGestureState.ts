import {
  type GestureAxis,
  type GesturePanStart,
} from './multiPointerGesture.js';
import { type ViewportState } from './viewportState.js';

export type ViewportCustomPan = {
  update: (delta: number) => void;
  end: () => void;
};

export type ViewportGestureOptions = {
  element: HTMLElement;
  readState: (axis: GestureAxis) => ViewportState | undefined;
  applyState: (state: ViewportState) => void;
  setFreeze: (freeze: boolean) => void;
  customPan?: (event: GesturePanStart) => ViewportCustomPan | undefined;
  zoomSensitivity?: number;
};

export type ViewportGesture = {
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

export type ViewportGestureMode =
  'idle' | 'pan' | 'pan-inertia' | 'custom-pan' | 'pinch-zoom' | 'drag-zoom';
