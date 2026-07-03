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

type TimelineWindow = {
  start: number;
  end: number;
  duration: number;
};

const getTimelineWindow = (config: TimelineConfig): TimelineWindow => {
  if (config.mode === 'spectrogram') {
    const currentTime = getCurrentTime(config);
    const start = currentTime - config.visibleTime * config.playheadRatio;

    return {
      start,
      end: start + config.visibleTime,
      duration: config.visibleTime,
    };
  }

  return {
    start: 0,
    end: config.duration,
    duration: config.duration,
  };
};

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
): TimelineMarker[] => {
  const timelineWindow = getTimelineWindow(config);
  const majorStep = getMajorStep(timelineWindow.duration, width);
  const minorStep = majorStep / markerDivisionCount;
  const start = Math.max(0, timelineWindow.start - majorStep);
  const end = Math.min(config.duration, timelineWindow.end);

  if (timelineWindow.duration <= 0 || end < start) {
    return [];
  }

  const firstMarkerIndex = Math.ceil((start - timelinePrecision) / minorStep);
  const lastMarkerIndex = Math.floor((end + timelinePrecision) / minorStep);

  return Array.from(
    { length: Math.max(0, lastMarkerIndex - firstMarkerIndex + 1) },
    (_value, index) => {
      const markerIndex = firstMarkerIndex + index;
      const time = markerIndex * minorStep;

      return {
        time,
        ratio: (time - timelineWindow.start) / timelineWindow.duration,
        isMajor: markerIndex % markerDivisionCount === 0,
      };
    },
  );
};
