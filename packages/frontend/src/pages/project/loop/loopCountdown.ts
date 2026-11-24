import { type EngineState } from '@musetric/engine';

const countBeats = (beats: readonly number[], after: number, upTo: number) =>
  beats.filter((beat) => beat > after && beat <= upTo).length;

export const getBeatsToFrom = (
  frameIndex: number,
  state: Pick<EngineState, 'range' | 'metronomeBeats'>,
  sampleRate: number,
): number | undefined => {
  const { range, metronomeBeats } = state;
  if (!range || metronomeBeats.length === 0) {
    return undefined;
  }
  const now = frameIndex / sampleRate;
  const from = range.fromFrame / sampleRate;
  const to = range.toFrame / sampleRate;
  if (now <= from) {
    return countBeats(metronomeBeats, now, from);
  }
  return countBeats(metronomeBeats, now, to);
};
