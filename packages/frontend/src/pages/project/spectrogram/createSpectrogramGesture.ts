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
const minVisibleTime = 0.1;
const maxVisibleTime = 60;

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

const readState = (
  context: SpectrogramGestureContext,
  axis: GestureAxis,
): ViewportState | undefined =>
  axis === 'x' ? readPositionState(context) : readRangeState(context);

export type SpectrogramGestureControls = {
  setVisibleTime: (visibleTime: number) => void;
  setFrequencyRange: (minFrequency: number, maxFrequency: number) => void;
  seek: (frameIndex: number) => void;
  setFreeze: (freeze: boolean) => void;
};

const applyState = (
  context: SpectrogramGestureContext,
  controls: SpectrogramGestureControls,
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
  return createViewportGesture({
    element,
    readState: (axis) => readState(context, axis),
    applyState: (state) => applyState(context, controls, state),
    setFreeze: controls.setFreeze,
    zoomSensitivity,
  });
};
