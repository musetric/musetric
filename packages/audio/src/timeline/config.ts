const requiredTimelineConfigKeys = [
  'canvas',
  'duration',
  'frameIndex',
  'visibleTime',
  'playheadRatio',
  'markerColor',
  'labelColor',
  'font',
] as const;

export type TimelineConfig = {
  canvas: HTMLCanvasElement;
  duration: number;
  frameIndex: number;
  frameCount?: number;
  visibleTime: number;
  playheadRatio: number;
  markerColor: string;
  labelColor: string;
  font: string;
};

const isTimelineConfigComplete = (
  config: Partial<TimelineConfig>,
): config is TimelineConfig =>
  requiredTimelineConfigKeys.every((key) => config[key] !== undefined);

export const buildTimelineConfig = (
  base?: TimelineConfig,
  draft?: Partial<TimelineConfig>,
) => {
  if (!draft) {
    return base;
  }

  if (!base) {
    if (!isTimelineConfigComplete(draft)) {
      return undefined;
    }
    return draft;
  }

  return {
    ...base,
    ...draft,
  };
};
