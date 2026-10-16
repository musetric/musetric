const semitonesPerOctave = 12;

export type TakeTarget = {
  tempoRatio: number;
  transposeSemitones: number;
  voiceOctave: number;
  voiceShifted: boolean;
};

type TakeKey = {
  tempo: number;
  transpose: number;
  octave: number;
};

export type TakeShift = {
  ratio: number;
  semitones: number;
};

export const getTakeShift = (target: TakeTarget, take: TakeKey): TakeShift => ({
  ratio: target.tempoRatio / take.tempo,
  semitones:
    target.transposeSemitones -
    take.transpose +
    semitonesPerOctave *
      (target.voiceShifted ? target.voiceOctave - take.octave : 0),
});
