export type TimelineMode = 'spectrogram' | 'waveform';

export type TimelineConfig = {
  canvas: HTMLCanvasElement;
  mode: TimelineMode;
  duration: number;
  frameIndex: number;
  frameCount?: number;
  visibleTime: number;
  playheadRatio: number;
  markerColor: string;
  labelColor: string;
  font: string;
};

const requiredTimelineConfigKeys = [
  'canvas',
  'mode',
  'duration',
  'frameIndex',
  'visibleTime',
  'playheadRatio',
  'markerColor',
  'labelColor',
  'font',
] as const;

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
