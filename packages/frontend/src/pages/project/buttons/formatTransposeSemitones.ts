export const formatTransposeSemitones = (semitones: number): string => {
  if (semitones > 0) {
    return `+${semitones}`;
  }
  if (semitones < 0) {
    return `−${-semitones}`;
  }

  return String(semitones);
};
