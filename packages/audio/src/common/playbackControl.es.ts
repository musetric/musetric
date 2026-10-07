export const getMinTempoBpm = (sourceTempoBpm: number) =>
  Math.ceil(sourceTempoBpm * 0.25);
export const getMaxTempoBpm = (sourceTempoBpm: number) =>
  Math.ceil(sourceTempoBpm * 2);

export const minTransposeSemitones = -12;
export const maxTransposeSemitones = 12;
