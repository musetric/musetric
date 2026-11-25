import {
  createViewportGesture,
  type GestureAxis,
  type ViewportGesture,
  type ViewportPositionState,
  type ViewportRangeState,
  type ViewportState,
} from '@musetric/interaction';
import {
  maximumSpectrogramFrequency,
  minimumSpectrogramFrequency,
  minimumSpectrogramFrequencyRatio,
} from '@musetric/spectrogram';

const logMinFrequency = Math.log(minimumSpectrogramFrequency);
const logMaxFrequency = Math.log(maximumSpectrogramFrequency);
const logMinRange = Math.log(minimumSpectrogramFrequencyRatio);
const logMaxRange = logMaxFrequency - logMinFrequency;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const minVisibleTime = 0.1;
const maxVisibleTime = 60;
const zoomLimitTolerance = 1e-9;
const edgeTolerance = 0.5;

export type SpectrogramViewWindow = {
  startFrame: number;
  frameCount: number;
};

export type SpectrogramGestureRange = {
  fromFrame: number;
  toFrame: number;
};

export type SpectrogramGestureContext = {
  getSampleRate: () => number;
  getFrameCount: () => number;
  getFrameIndex: () => number;
  getVisibleTime: () => number;
  getPlayheadRatio: () => number;
  getViewWindow: () => SpectrogramViewWindow | undefined;
  getRange: () => SpectrogramGestureRange | undefined;
  getMinFrequency: () => number;
  getMaxFrequency: () => number;
  getFrequencyBandCount: () => number;
};

const readPositionState = (
  context: SpectrogramGestureContext,
): ViewportPositionState | undefined => {
  const frameCount = context.getFrameCount();
  if (!frameCount) return undefined;
  const sampleRate = context.getSampleRate();
  const range = context.getRange();
  const viewWindow = context.getViewWindow();
  const position = context.getFrameIndex();
  return {
    kind: 'position',
    position,
    size: viewWindow?.frameCount ?? context.getVisibleTime() * sampleRate,
    originRatio: viewWindow
      ? (position - viewWindow.startFrame) / viewWindow.frameCount
      : context.getPlayheadRatio(),
    minimumPosition: range?.fromFrame ?? 0,
    maximumPosition: range ? range.toFrame - 1 : frameCount,
    minimumSize: minVisibleTime * sampleRate,
    maximumSize: viewWindow
      ? Math.max(maxVisibleTime * sampleRate, frameCount)
      : maxVisibleTime * sampleRate,
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
  bandCount: context.getFrequencyBandCount(),
});

const readState = (
  context: SpectrogramGestureContext,
  axis: GestureAxis,
): ViewportState | undefined =>
  axis === 'x' ? readPositionState(context) : readRangeState(context);

export type SpectrogramGestureControls = {
  setVisibleTime: (visibleTime: number) => void;
  setViewWindow: (viewWindow: SpectrogramViewWindow) => void;
  setFrequencyRange: (minFrequency: number, maxFrequency: number) => void;
  seek: (frameIndex: number) => void;
  setFreeze: (freeze: boolean) => void;
  onLimit: () => void;
};

const applyState = (
  context: SpectrogramGestureContext,
  controls: SpectrogramGestureControls,
  state: ViewportState,
) => {
  if (state.kind === 'position') {
    if (context.getViewWindow()) {
      controls.setViewWindow({
        startFrame: Math.round(state.position - state.originRatio * state.size),
        frameCount: Math.round(state.size),
      });
    } else {
      controls.setVisibleTime(state.size / context.getSampleRate());
    }
    if (Math.round(state.position) !== Math.round(context.getFrameIndex())) {
      controls.seek(state.position);
    }
    return;
  }

  controls.setFrequencyRange(Math.exp(state.lower), Math.exp(state.upper));
};

const readSize = (state: ViewportState): number =>
  state.kind === 'position' ? state.size : state.upper - state.lower;

const isAtZoomLimit = (limits: ViewportState, size: number): boolean =>
  size <= limits.minimumSize * (1 + zoomLimitTolerance) ||
  size >= limits.maximumSize * (1 - zoomLimitTolerance);

const reachesZoomLimit = (
  before: ViewportState | undefined,
  after: ViewportState,
): boolean =>
  isAtZoomLimit(after, readSize(after)) &&
  (before === undefined || !isAtZoomLimit(after, readSize(before)));

const isAtEdge = (state: ViewportState | undefined): boolean =>
  state?.kind === 'position' &&
  (state.position <= state.minimumPosition + edgeTolerance ||
    state.position >= state.maximumPosition - edgeTolerance);

const reachesEdge = (
  before: ViewportState | undefined,
  after: ViewportState,
): boolean => isAtEdge(after) && !isAtEdge(before);

export type SpectrogramGestureOptions = {
  element: HTMLElement;
  context: SpectrogramGestureContext;
  controls: SpectrogramGestureControls;
  zoomSensitivity?: number;
};

export const createSpectrogramGesture = (
  options: SpectrogramGestureOptions,
): ViewportGesture => {
  const { element, context, controls, zoomSensitivity } = options;
  let previous: ViewportState | undefined = undefined;
  return createViewportGesture({
    element,
    readState: (axis) => readState(context, axis),
    applyState: (state) => {
      const before = readState(context, state.kind === 'position' ? 'x' : 'y');
      applyState(context, controls, state);
      if (reachesZoomLimit(before, state) || reachesEdge(previous, state)) {
        controls.onLimit();
      }
      previous = state;
    },
    setFreeze: (shouldFreeze) => {
      if (!shouldFreeze) {
        previous = undefined;
      }
      controls.setFreeze(shouldFreeze);
    },
    readWheelAnchorRatio: (state) =>
      clamp(
        (context.getFrameIndex() - state.position) / state.size +
          state.originRatio,
        0,
        1,
      ),
    zoomSensitivity,
  });
};
