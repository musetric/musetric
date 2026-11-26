import { type TimelineConfig } from '../config.js';

const timelinePrecision = 0.000_001;
const markerDivisionCount = 4;
const targetLabelWidth = 96;
const secondSteps = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
] as const;

const getCurrentTime = (config: TimelineConfig) => {
  if (!config.frameCount) {
    return 0;
  }

  return (config.frameIndex / config.frameCount) * config.duration;
};

export const getTimelineWindowStart = (config: TimelineConfig): number =>
  getCurrentTime(config) - config.visibleTime * config.playheadRatio;

const getMajorStep = (duration: number, width: number) => {
  const targetMarkerCount = Math.max(1, Math.floor(width / targetLabelWidth));
  const rawStep = duration / targetMarkerCount;

  for (const step of secondSteps) {
    if (step >= rawStep) {
      return step;
    }
  }

  return secondSteps[secondSteps.length - 1];
};

export type TimelineMarker = {
  time: number;
  ratio: number;
  isMajor: boolean;
};

export const getTimelineMarkers = (
  config: TimelineConfig,
  width: number,
  start: number,
  screens: number,
): TimelineMarker[] => {
  const { visibleTime } = config;
  const majorStep = getMajorStep(visibleTime, width);
  const minorStep = majorStep / markerDivisionCount;
  const from = Math.max(0, start - majorStep);
  const end = Math.min(config.duration, start + visibleTime * screens);

  if (visibleTime <= 0 || end < from) {
    return [];
  }

  const firstMarkerIndex = Math.ceil((from - timelinePrecision) / minorStep);
  const lastMarkerIndex = Math.floor((end + timelinePrecision) / minorStep);

  return Array.from(
    { length: Math.max(0, lastMarkerIndex - firstMarkerIndex + 1) },
    (_value, index) => {
      const markerIndex = firstMarkerIndex + index;
      const time = markerIndex * minorStep;

      return {
        time,
        ratio: (time - start) / visibleTime,
        isMajor: markerIndex % markerDivisionCount === 0,
      };
    },
  );
};
