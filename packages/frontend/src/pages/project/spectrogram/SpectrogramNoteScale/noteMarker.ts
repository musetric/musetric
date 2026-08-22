import {
  getFrequencyMidi,
  getMidiFrequency,
  getMidiLabel,
} from './notePitch.js';

const naturalNoteSteps = new Set([0, 2, 4, 5, 7, 9, 11]);

export const isNaturalMidi = (midi: number): boolean =>
  naturalNoteSteps.has(midi % 12);

export const isOctaveMidi = (midi: number): boolean => midi % 12 === 0;

const getFrequencyYRatio = (
  frequency: number,
  minFrequency: number,
  maxFrequency: number,
) => {
  if (maxFrequency <= minFrequency) {
    return undefined;
  }

  const logMin = Math.log(minFrequency);
  const logRange = Math.log(maxFrequency) - logMin;
  if (!logRange) {
    return undefined;
  }

  const frequencyRatio = (Math.log(frequency) - logMin) / logRange;
  return 1 - frequencyRatio;
};

export type NoteMarker = {
  label: string;
  midi: number;
  topRatio: number;
};

export const getNoteMarkers = (
  minFrequency: number,
  maxFrequency: number,
): NoteMarker[] => {
  const minMidi = Math.ceil(getFrequencyMidi(minFrequency));
  const maxMidi = Math.floor(getFrequencyMidi(maxFrequency));
  const markers: NoteMarker[] = [];

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const yRatio = getFrequencyYRatio(
      getMidiFrequency(midi),
      minFrequency,
      maxFrequency,
    );
    if (yRatio === undefined) {
      continue;
    }

    markers.push({
      label: getMidiLabel(midi),
      midi,
      topRatio: yRatio,
    });
  }

  return markers.sort((a, b) => a.topRatio - b.topRatio);
};
