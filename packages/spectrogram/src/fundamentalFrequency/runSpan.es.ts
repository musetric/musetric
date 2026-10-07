import { type PitchSettings } from './settings.es.js';

export type SpanPlanner = {
  settings: Pick<PitchSettings, 'hop' | 'support' | 'spanCapacity'>;
  spanEnd: number;
  position: (songFrame: number) => number;
};

export type RunSpan = {
  taken: number;
  sampleStart: number;
  length: number;
  offsetOf: (frame: number) => number;
};

export const fitRunSpan = (
  planner: SpanPlanner,
  startFrame: number,
  first: number,
  wanted: number,
): RunSpan | undefined => {
  const { hop, support, spanCapacity } = planner.settings;
  const centerOf = (frame: number) => Math.round(planner.position(frame * hop));
  const startCenter = centerOf(startFrame);
  const lengthOf = (frames: number) =>
    centerOf(first + frames - 1) - startCenter + 2 * support + 1;
  let taken = wanted;
  while (taken > 0 && planner.spanEnd + lengthOf(taken) > spanCapacity) {
    taken = Math.floor(taken / 2);
  }
  if (taken <= 0) {
    return undefined;
  }
  return {
    taken,
    sampleStart: startCenter - support,
    length: lengthOf(taken),
    offsetOf: (frame) => centerOf(frame) - startCenter,
  };
};
