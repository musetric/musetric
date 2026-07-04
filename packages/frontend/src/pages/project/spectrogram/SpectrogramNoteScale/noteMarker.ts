import {
  getFrequencyMidi,
  getMidiFrequency,
  getMidiLabel,
} from './notePitch.js';

export type NoteLineTone = 'primary' | 'secondary' | 'gray';

export type NoteMarker = {
  label: string;
  midi: number;
  tone: NoteLineTone;
  topRatio: number;
};

const naturalNoteSteps = new Set([0, 2, 4, 5, 7, 9, 11]);

export const isNaturalMidi = (midi: number): boolean =>
  naturalNoteSteps.has(midi % 12);

const primaryLineSteps = [2, 4, 6, 8] as const;
const targetPrimaryLineCount = 10;

const getPrimaryLineStep = (noteCount: number) =>
  primaryLineSteps.reduce((bestStep, step) => {
    const bestDistance = Math.abs(
      noteCount / bestStep - targetPrimaryLineCount,
    );
    const distance = Math.abs(noteCount / step - targetPrimaryLineCount);
    return distance < bestDistance ? step : bestStep;
  });

const getNoteLineTone = (
  midi: number,
  primaryLineStep: number,
): NoteLineTone => {
  if (midi % primaryLineStep === 0) {
    return 'primary';
  }

  return midi % 2 === 0 ? 'secondary' : 'gray';
};

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

export const getNoteMarkers = (
  minFrequency: number,
  maxFrequency: number,
): NoteMarker[] => {
  const minMidi = Math.ceil(getFrequencyMidi(minFrequency));
  const maxMidi = Math.floor(getFrequencyMidi(maxFrequency));
  const noteCount = maxMidi - minMidi + 1;
  const primaryLineStep = getPrimaryLineStep(noteCount);
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
      tone: getNoteLineTone(midi, primaryLineStep),
      topRatio: yRatio,
    });
  }

  return markers.sort((a, b) => a.topRatio - b.topRatio);
};
