const tempoTolerance = 1e-6;

export type TakeWindow = {
  firstFrame: number;
  tempo: number;
  samples: Float32Array<ArrayBuffer>;
};

export const takeFrameOnSong = (
  take: Pick<TakeWindow, 'firstFrame' | 'tempo'>,
  index: number,
): number => take.firstFrame + index * take.tempo;

export const createTakeWindow = (
  firstFrame: number,
  lastFrame: number,
  tempo: number,
): TakeWindow => ({
  firstFrame,
  tempo,
  samples: new Float32Array(
    Math.max(0, Math.ceil((lastFrame - firstFrame) / tempo)),
  ),
});

type TakePiece = {
  songStartFrame: number;
  tempo: number;
  samples: Float32Array;
};

export const layTakePiece = (take: TakeWindow, piece: TakePiece): void => {
  if (Math.abs(piece.tempo - take.tempo) > tempoTolerance) {
    throw new Error(
      `A piece of the take was sung at tempo ${piece.tempo}, not ${take.tempo}`,
    );
  }
  const start = Math.round(
    (piece.songStartFrame - take.firstFrame) / take.tempo,
  );
  const skipped = Math.max(0, -start);
  const at = Math.max(0, start);
  const count = Math.min(
    piece.samples.length - skipped,
    take.samples.length - at,
  );
  if (count > 0) {
    take.samples.set(piece.samples.subarray(skipped, skipped + count), at);
  }
};
