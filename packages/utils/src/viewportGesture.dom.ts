import { type InertialDragPhysicsOptions } from './inertialDrag.js';
import {
  createMultiPointerGesture,
  type GestureAxis,
  type GesturePanStart,
  type GesturePanUpdate,
  type GesturePhase,
  type GesturePinchStart,
  type GesturePinchUpdate,
  type GesturePointerType,
} from './multiPointerGesture.dom.js';
import {
  panViewportState,
  type ViewportState,
  zoomViewportState,
} from './viewportState.js';

const defaultWheelZoomSensitivity = 0.002;
const defaultWheelLinePixels = 16;
const defaultWheelPagePixels = 400;

const noop = () => undefined;

export type ViewportGestureElements = {
  target: HTMLElement;
  viewport?: HTMLElement;
};

const getViewportElement = (elements: ViewportGestureElements) =>
  elements.viewport ?? elements.target;

export type ViewportGestureAxis = GestureAxis;

const getAxisSize = (rect: DOMRect, axis: ViewportGestureAxis) => {
  if (axis === 'x') {
    return rect.width;
  }

  return rect.height;
};

const getAxisRatio = (
  rect: DOMRect,
  axis: ViewportGestureAxis,
  clientX: number,
  clientY: number,
) => {
  if (axis === 'x') {
    return (clientX - rect.left) / rect.width;
  }

  return (clientY - rect.top) / rect.height;
};

const getWheelAxis = (event: WheelEvent): ViewportGestureAxis | undefined => {
  if (event.shiftKey) {
    return 'x';
  }

  if (event.ctrlKey || event.metaKey) {
    return 'y';
  }

  return undefined;
};

export type ViewportGestureWheelOptions = {
  zoomSensitivity?: number;
  linePixels?: number;
  pagePixels?: number;
};

const getWheelDelta = (
  event: WheelEvent,
  wheelOptions: ViewportGestureWheelOptions,
) => {
  const linePixels = wheelOptions.linePixels ?? defaultWheelLinePixels;
  const pagePixels = wheelOptions.pagePixels ?? defaultWheelPagePixels;

  if (event.deltaMode === 1) {
    return event.deltaY * linePixels;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * pagePixels;
  }

  return event.deltaY;
};

export type ViewportGesturePointerOptions = {
  pointerTypes?: readonly GesturePointerType[];
  axisLockDistance?: number;
  pinchLockDistance?: number;
  minimumPinchSpread?: number;
};

export type ViewportGestureInputOptions = {
  pointer?: ViewportGesturePointerOptions;
  wheel?: ViewportGestureWheelOptions | false;
};

const getWheelOptions = (
  input: ViewportGestureInputOptions | undefined,
): ViewportGestureWheelOptions | undefined => {
  if (input?.wheel === false) {
    return undefined;
  }

  return input?.wheel ?? {};
};

export type ViewportGestureSource = 'pan' | 'pinch' | 'wheel';

export type ViewportGestureStateRequest = {
  axis: ViewportGestureAxis;
  source: ViewportGestureSource;
};

export type ViewportGestureStart = {
  axis: ViewportGestureAxis;
  source: 'pan' | 'pinch';
};

export type ViewportGestureEnd = {
  axis: ViewportGestureAxis | undefined;
  source: 'pan' | 'pinch';
};

export type ViewportGestureUpdatePhase = GesturePhase | 'zoom';

export type ViewportGestureUpdate = {
  axis: ViewportGestureAxis;
  source: ViewportGestureSource;
  phase: ViewportGestureUpdatePhase;
  state: ViewportState;
  stop: () => void;
};

export type ViewportGestureHandlers = {
  getState: (request: ViewportGestureStateRequest) => ViewportState | undefined;
  onStart?: (event: ViewportGestureStart) => void;
  onUpdate: (event: ViewportGestureUpdate) => void;
  onEnd?: (event: ViewportGestureEnd) => void;
};

export type ViewportGestureOptions = {
  elements: ViewportGestureElements;
  input?: ViewportGestureInputOptions;
  inertia?: InertialDragPhysicsOptions;
  handlers: ViewportGestureHandlers;
};

export type ViewportGesture = {
  stop: () => void;
  dispose: () => void;
};

type ActivePan = {
  axis: ViewportGestureAxis;
  state: ViewportState;
};

type ActivePinch = {
  axis: ViewportGestureAxis;
  initialSpread: number;
  state: ViewportState;
};

export const createViewportGesture = (
  options: ViewportGestureOptions,
): ViewportGesture => {
  const viewportElement = getViewportElement(options.elements);
  const wheelOptions = getWheelOptions(options.input);
  let activePan: ActivePan | undefined = undefined;
  let activePinch: ActivePinch | undefined = undefined;

  const readState = (
    axis: ViewportGestureAxis,
    source: ViewportGestureSource,
  ) =>
    options.handlers.getState({
      axis,
      source,
    });

  const handlePanStart = (event: GesturePanStart) => {
    options.handlers.onStart?.({
      axis: event.axis,
      source: 'pan',
    });

    const state = readState(event.axis, 'pan');
    activePan = state
      ? {
          axis: event.axis,
          state,
        }
      : undefined;
  };

  const handlePanUpdate = (event: GesturePanUpdate) => {
    const rect = viewportElement.getBoundingClientRect();
    const axisSize = getAxisSize(rect, event.axis);

    if (axisSize <= 0) {
      event.stop();
      return;
    }

    const currentPan =
      activePan && activePan.axis === event.axis
        ? activePan
        : {
            axis: event.axis,
            state: readState(event.axis, 'pan'),
          };

    if (!currentPan.state) {
      event.stop();
      return;
    }

    const result = panViewportState({
      state: currentPan.state,
      delta: event.delta,
      viewportSize: axisSize,
    });
    activePan = {
      axis: event.axis,
      state: result.state,
    };

    options.handlers.onUpdate({
      axis: event.axis,
      source: 'pan',
      phase: event.phase,
      state: result.state,
      stop: event.stop,
    });

    if (event.phase === 'inertia' && result.clamped) {
      event.stop();
    }
  };

  const handlePanEnd = () => {
    const axis = activePan?.axis;
    activePan = undefined;
    options.handlers.onEnd?.({
      axis,
      source: 'pan',
    });
  };

  const handlePinchStart = (event: GesturePinchStart) => {
    options.handlers.onStart?.({
      axis: event.axis,
      source: 'pinch',
    });

    const state = readState(event.axis, 'pinch');
    activePinch = state
      ? {
          axis: event.axis,
          initialSpread: Math.max(event.spread, 1),
          state,
        }
      : undefined;
  };

  const handlePinchUpdate = (event: GesturePinchUpdate) => {
    if (!activePinch || activePinch.axis !== event.axis) {
      return;
    }

    const rect = viewportElement.getBoundingClientRect();
    const axisSize = getAxisSize(rect, event.axis);

    if (axisSize <= 0) {
      return;
    }

    const axisRatio =
      event.axis === 'x'
        ? (event.center - rect.left) / axisSize
        : (event.center - rect.top) / axisSize;
    const scale = event.spread / activePinch.initialSpread;
    const result = zoomViewportState({
      state: activePinch.state,
      anchorRatio: axisRatio,
      scale,
    });

    options.handlers.onUpdate({
      axis: event.axis,
      source: 'pinch',
      phase: 'zoom',
      state: result.state,
      stop: noop,
    });
  };

  const handlePinchEnd = () => {
    const axis = activePinch?.axis;
    activePinch = undefined;
    options.handlers.onEnd?.({
      axis,
      source: 'pinch',
    });
  };

  const handleWheel = (event: WheelEvent) => {
    if (!wheelOptions) {
      return;
    }

    const axis = getWheelAxis(event);

    if (!axis) {
      return;
    }

    const rect = viewportElement.getBoundingClientRect();
    const axisSize = getAxisSize(rect, axis);

    if (axisSize <= 0) {
      return;
    }

    event.preventDefault();

    const state = readState(axis, 'wheel');

    if (!state) {
      return;
    }

    const zoomSensitivity =
      wheelOptions.zoomSensitivity ?? defaultWheelZoomSensitivity;
    const delta = getWheelDelta(event, wheelOptions);
    const scale = Math.exp(-delta * zoomSensitivity);
    const anchorRatio = getAxisRatio(rect, axis, event.clientX, event.clientY);
    const result = zoomViewportState({
      state,
      anchorRatio,
      scale,
    });

    options.handlers.onUpdate({
      axis,
      source: 'wheel',
      phase: 'zoom',
      state: result.state,
      stop: noop,
    });
  };

  const gesture = createMultiPointerGesture({
    element: options.elements.target,
    pointerTypes: options.input?.pointer?.pointerTypes,
    axisLockDistance: options.input?.pointer?.axisLockDistance,
    pinchLockDistance: options.input?.pointer?.pinchLockDistance,
    minimumPinchSpread: options.input?.pointer?.minimumPinchSpread,
    inertiaTimeConstantMs: options.inertia?.inertiaTimeConstantMs,
    inertiaMinimumVelocity: options.inertia?.inertiaMinimumVelocity,
    inertiaVelocityMultiplier: options.inertia?.inertiaVelocityMultiplier,
    stationaryDistance: options.inertia?.stationaryDistance,
    stationaryVelocityResetMs: options.inertia?.stationaryVelocityResetMs,
    velocitySampleDurationMs: options.inertia?.velocitySampleDurationMs,
    onPanStart: handlePanStart,
    onPanUpdate: handlePanUpdate,
    onPanEnd: handlePanEnd,
    onPinchStart: handlePinchStart,
    onPinchUpdate: handlePinchUpdate,
    onPinchEnd: handlePinchEnd,
  });

  if (wheelOptions) {
    viewportElement.addEventListener('wheel', handleWheel, { passive: false });
  }

  return {
    stop: gesture.stop,
    dispose: () => {
      if (wheelOptions) {
        viewportElement.removeEventListener('wheel', handleWheel);
      }
      gesture.dispose();
    },
  };
};
