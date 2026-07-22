const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export type ViewportPositionState = {
  kind: 'position';
  position: number;
  size: number;
  originRatio: number;
  minimumPosition: number;
  maximumPosition: number;
  minimumSize: number;
  maximumSize: number;
  panDirection: number;
};

export type ViewportRangeState = {
  kind: 'range';
  lower: number;
  upper: number;
  minimumValue: number;
  maximumValue: number;
  minimumSize: number;
  maximumSize: number;
  panDirection: number;
  reverse: boolean;
};

export type ViewportState = ViewportPositionState | ViewportRangeState;

export type ViewportStateUpdate = {
  state: ViewportState;
  clamped: boolean;
};

const panPositionViewport = (
  state: ViewportPositionState,
  delta: number,
  viewportSize: number,
): ViewportStateUpdate => {
  const rawPosition =
    state.position + (state.panDirection * delta * state.size) / viewportSize;
  const position = clamp(
    rawPosition,
    state.minimumPosition,
    state.maximumPosition,
  );

  return {
    state: {
      ...state,
      position,
    },
    clamped: position !== rawPosition,
  };
};

const panRangeViewport = (
  state: ViewportRangeState,
  delta: number,
  viewportSize: number,
): ViewportStateUpdate => {
  const size = state.upper - state.lower;
  const rawShift = (state.panDirection * delta * size) / viewportSize;
  const shift = clamp(
    rawShift,
    state.minimumValue - state.lower,
    state.maximumValue - state.upper,
  );

  return {
    state: {
      ...state,
      lower: state.lower + shift,
      upper: state.upper + shift,
    },
    clamped: shift !== rawShift,
  };
};

const zoomPositionViewport = (
  state: ViewportPositionState,
  anchorRatio: number,
  scale: number,
): ViewportStateUpdate => {
  const size = clamp(state.size / scale, state.minimumSize, state.maximumSize);
  const anchorPosition =
    state.position - state.originRatio * state.size + anchorRatio * state.size;
  const rawPosition = anchorPosition + (state.originRatio - anchorRatio) * size;
  const position = clamp(
    rawPosition,
    state.minimumPosition,
    state.maximumPosition,
  );

  return {
    state: {
      ...state,
      position,
      size,
    },
    clamped: position !== rawPosition,
  };
};

type RangeClampResult = {
  lower: number;
  upper: number;
};

const clampRangeViewport = (
  lower: number,
  upper: number,
  state: ViewportRangeState,
): RangeClampResult => {
  let nextLower = lower;
  let nextUpper = upper;

  if (nextLower < state.minimumValue) {
    const shift = state.minimumValue - nextLower;
    nextLower += shift;
    nextUpper += shift;
  }

  if (nextUpper > state.maximumValue) {
    const shift = nextUpper - state.maximumValue;
    nextLower -= shift;
    nextUpper -= shift;
  }

  return {
    lower: Math.max(state.minimumValue, nextLower),
    upper: Math.min(state.maximumValue, nextUpper),
  };
};

const zoomRangeViewport = (
  state: ViewportRangeState,
  anchorRatio: number,
  scale: number,
): ViewportStateUpdate => {
  const size = state.upper - state.lower;
  const nextSize = clamp(size / scale, state.minimumSize, state.maximumSize);
  const anchorValue = state.reverse
    ? state.upper - anchorRatio * size
    : state.lower + anchorRatio * size;
  const rawLower = state.reverse
    ? anchorValue - (1 - anchorRatio) * nextSize
    : anchorValue - anchorRatio * nextSize;
  const rawUpper = rawLower + nextSize;
  const range = clampRangeViewport(rawLower, rawUpper, state);

  return {
    state: {
      ...state,
      lower: range.lower,
      upper: range.upper,
    },
    clamped: range.lower !== rawLower || range.upper !== rawUpper,
  };
};

export type ViewportPanOptions = {
  state: ViewportState;
  delta: number;
  viewportSize: number;
};

export const panViewportState = (
  options: ViewportPanOptions,
): ViewportStateUpdate => {
  if (options.state.kind === 'position') {
    return panPositionViewport(
      options.state,
      options.delta,
      options.viewportSize,
    );
  }

  return panRangeViewport(options.state, options.delta, options.viewportSize);
};

export type ViewportZoomOptions = {
  state: ViewportState;
  anchorRatio: number;
  scale: number;
};

export const zoomViewportState = (
  options: ViewportZoomOptions,
): ViewportStateUpdate => {
  if (options.state.kind === 'position') {
    return zoomPositionViewport(
      options.state,
      options.anchorRatio,
      options.scale,
    );
  }

  return zoomRangeViewport(options.state, options.anchorRatio, options.scale);
};
