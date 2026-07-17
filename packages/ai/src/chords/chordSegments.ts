import { chordLabelAt, noChordLabel, unknownChordLabel } from './chordVocab.js';

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

type SplitLabel = {
  root: string;
  quality: string | undefined;
};

const splitLabel = (label: string): SplitLabel => {
  if (label === noChordLabel || label === unknownChordLabel) {
    return { root: label, quality: undefined };
  }
  const colon = label.indexOf(':');
  if (colon >= 0) {
    return { root: label.slice(0, colon), quality: label.slice(colon + 1) };
  }
  return { root: label, quality: 'maj' };
};

export type ChordSegment = {
  start: number;
  end: number;
  label: string;
  root: string;
  quality?: string;
};

export type ChordResult = {
  segments: ChordSegment[];
};

export const buildChordSegments = (
  indices: Int32Array | readonly number[],
  frameDuration: number,
): ChordResult => {
  const segments: ChordSegment[] = [];
  if (indices.length === 0) {
    return { segments };
  }

  const append = (start: number, end: number, index: number): void => {
    const label = chordLabelAt(index);
    const { root, quality } = splitLabel(label);
    segments.push({
      start: round3(start),
      end: round3(end),
      label,
      root,
      quality,
    });
  };

  let [previous] = indices;
  let startTime = 0;
  for (let i = 1; i < indices.length; i += 1) {
    const current = indices[i];
    if (current !== previous) {
      const endTime = i * frameDuration;
      append(startTime, endTime, previous);
      startTime = endTime;
      previous = current;
    }
  }
  append(startTime, indices.length * frameDuration, previous);
  return { segments };
};
