import { describe, expect, it } from 'vitest';
import { type TakeTarget } from '../../player/takeShift.cross.js';
import { renderPieces } from '../recordingAssembly.worker.js';
import { type TakeStretch } from '../takeStretch.worker.js';

type StretchCall = {
  ratio: number;
  semitones: number;
};

const createStretch = (calls: StretchCall[]): TakeStretch => ({
  render: (samples, ratio, semitones) => {
    calls.push({ ratio, semitones });
    return new Float32Array(Math.round(samples.length / ratio)).fill(9);
  },
});

const original: TakeTarget = {
  tempoRatio: 1,
  transposeSemitones: 0,
  voiceOctave: 0,
  voiceShifted: false,
};

describe('render pieces', () => {
  it('lays a take sung at the export tempo and key as it was sung', () => {
    const calls: StretchCall[] = [];
    const rendered = renderPieces(
      [
        {
          songStartFrame: 8,
          tempo: 0.5,
          transpose: 2,
          octave: 0,
          samples: Float32Array.from([1, 2, 3]),
        },
      ],
      20,
      createStretch(calls),
      { ...original, tempoRatio: 0.5, transposeSemitones: 2 },
    );

    expect(rendered).toHaveLength(40);
    expect(Array.from(rendered.subarray(15, 20))).toEqual([0, 1, 2, 3, 0]);
    expect(calls).toEqual([]);
  });

  it('moves a take from another key and octave like the live voice does', () => {
    const calls: StretchCall[] = [];
    const rendered = renderPieces(
      [
        {
          songStartFrame: 10,
          tempo: 1,
          transpose: 1,
          octave: -1,
          samples: Float32Array.from([1, 1, 1, 1]),
        },
      ],
      20,
      createStretch(calls),
      {
        tempoRatio: 0.8,
        transposeSemitones: 3,
        voiceOctave: 0,
        voiceShifted: true,
      },
    );

    expect(rendered).toHaveLength(25);
    expect(calls).toEqual([{ ratio: 0.8, semitones: 14 }]);
    expect(Array.from(rendered.subarray(12, 19))).toEqual([
      0, 9, 9, 9, 9, 9, 0,
    ]);
  });

  it('keeps the octave out of the shift while the singer sounds as sung', () => {
    const calls: StretchCall[] = [];
    renderPieces(
      [
        {
          songStartFrame: 0,
          tempo: 1,
          transpose: 0,
          octave: 1,
          samples: Float32Array.from([1, 1]),
        },
      ],
      4,
      createStretch(calls),
      { ...original, voiceOctave: -1 },
    );

    expect(calls).toEqual([]);
  });
});
