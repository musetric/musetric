const noteNames = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

const a4Midi = 69;
const a4Frequency = 440;
const semitonesPerOctave = 12;

type NoteName = (typeof noteNames)[number];

const getNoteName = (midi: number): NoteName => noteNames[midi % 12];

export const getFrequencyMidi = (frequency: number) =>
  a4Midi + semitonesPerOctave * Math.log2(frequency / a4Frequency);

export const getMidiFrequency = (midi: number) =>
  a4Frequency * 2 ** ((midi - a4Midi) / semitonesPerOctave);

export const getMidiLabel = (midi: number) => {
  const noteName = getNoteName(midi);
  const octave = Math.floor(midi / semitonesPerOctave) - 1;
  return `${noteName}${octave}`;
};
