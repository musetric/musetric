import { createInertialDragPhysics } from './inertialDrag.js';
import { createInertiaRunner, type InertiaRunner } from './inertiaRunner.js';
import {
  createMultiPointerGesture,
  type GestureAxis,
  type GestureModifiers,
  type GesturePanEnd,
  type GesturePanStart,
  type GesturePanUpdate,
  type GesturePinchStart,
  type GesturePinchUpdate,
} from './multiPointerGesture.js';
import { isPointerInputType, isPrimaryPointerButton } from './pointerType.js';
import {
  getViewportAxisSize,
  getViewportCoordinateAnchorRatio,
  getViewportDragZoomScale,
  getViewportPointAnchorRatio,
} from './viewportGeometry.js';
import {
  type ActiveDragZoom,
  type ActivePan,
  type ActivePinchZoom,
  type ActiveZoom,
  type ViewportGesture,
  type ViewportGestureMode,
  type ViewportGestureOptions,
} from './viewportGestureState.js';
import {
  panViewportState,
  type ViewportState,
  zoomViewportState,
} from './viewportState.js';
import { createWheelHandler, type WheelUpdate } from './wheel.js';

const isZoomDragModifier = (modifiers: GestureModifiers): boolean =>
  modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey;

export const createViewportGesture = (
  options: ViewportGestureOptions,
): ViewportGesture => {
  const {
    element,
    readState,
    applyState,
    setFreeze,
    zoomSensitivity = 0.002,
  } = options;
  const physics = createInertialDragPhysics();
  let mode: ViewportGestureMode = 'idle';
  let pointerFrozen = false;
  let activePan: ActivePan | undefined = undefined;
  let activePinchZoom: ActivePinchZoom | undefined = undefined;
  let activeDragZoom: ActiveDragZoom | undefined = undefined;
  let inertiaRunner: InertiaRunner<GestureAxis> | undefined = undefined;

  const freeze = () => {
    if (pointerFrozen) return;
    pointerFrozen = true;
    setFreeze(true);
  };

  const releaseFrozen = () => {
    if (!pointerFrozen) return;
    pointerFrozen = false;
    setFreeze(false);
  };

  const getStateAnchorRatio = (
    state: ViewportState,
    axis: GestureAxis,
    coordinate: number,
  ): number | undefined =>
    getViewportCoordinateAnchorRatio(element, state, axis, coordinate);

  const getPointAnchorRatio = (
    state: ViewportState,
    axis: GestureAxis,
    clientX: number,
    clientY: number,
  ): number | undefined =>
    getViewportPointAnchorRatio({ element, state, axis, clientX, clientY });

  const applyPan = (pan: ActivePan, delta: number): boolean => {
    const viewportSize = getViewportAxisSize(element, pan.axis);
    if (viewportSize <= 0) return true;
    const result = panViewportState({
      state: pan.state,
      delta,
      viewportSize,
    });
    pan.state = result.state;
    applyState(result.state);
    return result.clamped;
  };

  const applyZoom = (zoom: ActiveZoom, scale: number) => {
    const result = zoomViewportState({
      state: zoom.startState,
      anchorRatio: zoom.anchorRatio,
      scale,
    });
    applyState(result.state);
  };

  const clearActiveGesture = () => {
    activePan = undefined;
    activePinchZoom = undefined;
    activeDragZoom = undefined;
  };

  const stopInertia = () => {
    if (!inertiaRunner) return;
    inertiaRunner.stop(false);
    inertiaRunner = undefined;
    if (mode === 'pan-inertia') {
      mode = 'idle';
    }
    activePan = undefined;
  };

  const startPanInertia = (axis: GestureAxis, velocity: number) => {
    mode = 'pan-inertia';
    inertiaRunner = createInertiaRunner(physics, {
      onUpdate: (info) => {
        if (mode !== 'pan-inertia' || !activePan || activePan.axis !== axis) {
          return true;
        }

        return applyPan(activePan, info.delta);
      },
      onEnd: () => {
        inertiaRunner = undefined;
        mode = 'idle';
        activePan = undefined;
        releaseFrozen();
      },
    });
    inertiaRunner.start(velocity, axis, performance.now());
  };

  const startPan = (event: GesturePanStart) => {
    const state = readState(event.axis);
    if (!state) {
      activePan = undefined;
      mode = 'idle';
      return;
    }

    activePan = {
      axis: event.axis,
      state,
    };
    mode = 'pan';
  };

  const startDragZoom = (event: GesturePanStart) => {
    const state = readState(event.axis);
    if (!state) {
      activeDragZoom = undefined;
      mode = 'idle';
      return;
    }

    const anchorRatio = getPointAnchorRatio(
      state,
      event.axis,
      event.startClientX,
      event.startClientY,
    );
    if (anchorRatio === undefined) {
      activeDragZoom = undefined;
      mode = 'idle';
      return;
    }

    activeDragZoom = {
      axis: event.axis,
      anchorRatio,
      startState: state,
      totalDelta: 0,
    };
    mode = 'drag-zoom';
  };

  const handlePanStart = (event: GesturePanStart) => {
    stopInertia();
    if (isZoomDragModifier(event.modifiers)) {
      startDragZoom(event);
    } else {
      startPan(event);
    }
    freeze();
  };

  const handlePanUpdate = (event: GesturePanUpdate) => {
    if (mode === 'pan' && activePan && activePan.axis === event.axis) {
      applyPan(activePan, event.delta);
      return;
    }

    if (
      mode === 'drag-zoom' &&
      activeDragZoom &&
      activeDragZoom.axis === event.axis
    ) {
      activeDragZoom.totalDelta += event.delta;
      applyZoom(
        activeDragZoom,
        getViewportDragZoomScale(
          activeDragZoom.axis,
          activeDragZoom.totalDelta,
          zoomSensitivity,
        ),
      );
      return;
    }

    event.stop();
  };

  const handlePanEnd = (event: GesturePanEnd) => {
    if (mode === 'pan' && activePan && activePan.axis === event.axis) {
      if (Math.abs(event.velocity) >= physics.inertiaMinimumVelocity) {
        startPanInertia(event.axis, event.velocity);
        return;
      }

      activePan = undefined;
    }

    if (mode === 'drag-zoom') {
      activeDragZoom = undefined;
    }

    mode = 'idle';
    releaseFrozen();
  };

  const handlePanAbort = () => {
    mode = 'idle';
    clearActiveGesture();
    releaseFrozen();
  };

  const handlePinchStart = (event: GesturePinchStart) => {
    stopInertia();
    const state = readState(event.axis);
    if (!state) {
      activePinchZoom = undefined;
      mode = 'idle';
      return;
    }

    const anchorRatio = getStateAnchorRatio(
      state,
      event.axis,
      event.startCenter,
    );
    if (anchorRatio === undefined) {
      activePinchZoom = undefined;
      mode = 'idle';
      return;
    }

    activePinchZoom = {
      axis: event.axis,
      anchorRatio,
      startSpread: event.startSpread,
      startState: state,
    };
    mode = 'pinch-zoom';
    freeze();
  };

  const handlePinchUpdate = (event: GesturePinchUpdate) => {
    if (
      mode !== 'pinch-zoom' ||
      !activePinchZoom ||
      activePinchZoom.axis !== event.axis
    ) {
      return;
    }

    applyZoom(activePinchZoom, event.spread / activePinchZoom.startSpread);
  };

  const handlePinchEnd = () => {
    mode = 'idle';
    activePinchZoom = undefined;
    releaseFrozen();
  };

  const handleWheel = (event: WheelUpdate) => {
    stopInertia();
    const state = readState(event.axis);
    if (!state) return;
    const anchorRatio = getPointAnchorRatio(
      state,
      event.axis,
      event.clientX,
      event.clientY,
    );
    if (anchorRatio === undefined) return;

    freeze();
    applyZoom(
      {
        axis: event.axis,
        anchorRatio,
        startState: state,
      },
      Math.exp(-event.delta * zoomSensitivity),
    );
    releaseFrozen();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!isPrimaryPointerButton(event)) return;
    if (!event.isPrimary) return;
    if (!isPointerInputType(event.pointerType)) return;
    stopInertia();
    freeze();
  };

  const handlePointerEnd = () => {
    if (mode === 'idle' && !inertiaRunner) {
      releaseFrozen();
    }
  };

  element.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointerup', handlePointerEnd, true);
  document.addEventListener('pointercancel', handlePointerEnd, true);

  const multiPointer = createMultiPointerGesture({
    element,
    createVelocityTracker: physics.createVelocityTracker,
    onPanStart: handlePanStart,
    onPanUpdate: handlePanUpdate,
    onPanEnd: handlePanEnd,
    onPanAbort: handlePanAbort,
    onPinchStart: handlePinchStart,
    onPinchUpdate: handlePinchUpdate,
    onPinchEnd: handlePinchEnd,
  });
  const wheel = createWheelHandler(element, handleWheel);

  const abort = () => {
    stopInertia();
    multiPointer.stop();
    mode = 'idle';
    clearActiveGesture();
    releaseFrozen();
  };

  return {
    abort,
    dispose: () => {
      abort();
      multiPointer.dispose();
      wheel.dispose();
      element.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerEnd, true);
      document.removeEventListener('pointercancel', handlePointerEnd, true);
    },
  };
};
