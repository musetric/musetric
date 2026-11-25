export type RecordingSpan = {
  songStartFrame: number;
  tempo: number;
  frameCount: number;
};

export const pieceSongEnd = (piece: RecordingSpan): number =>
  piece.songStartFrame + piece.frameCount * piece.tempo;

export type RecordingPiece = RecordingSpan & {
  transpose: number;
  octave: number;
  samples: Float32Array<ArrayBuffer>;
};

export type RecordingSegment<Piece extends RecordingSpan = RecordingPiece> = {
  songStartFrame: number;
  songEndFrame: number;
  piece: Piece;
};

export const toRecordingSegments = <Piece extends RecordingSpan>(
  pieces: readonly Piece[],
): RecordingSegment<Piece>[] => {
  let segments: RecordingSegment<Piece>[] = [];
  for (const piece of pieces) {
    const start = piece.songStartFrame;
    const end = pieceSongEnd(piece);
    if (end <= start) {
      continue;
    }
    const kept: RecordingSegment<Piece>[] = [];
    for (const segment of segments) {
      if (segment.songEndFrame <= start || segment.songStartFrame >= end) {
        kept.push(segment);
        continue;
      }
      if (segment.songStartFrame < start) {
        kept.push({ ...segment, songEndFrame: start });
      }
      if (segment.songEndFrame > end) {
        kept.push({ ...segment, songStartFrame: end });
      }
    }
    kept.push({ songStartFrame: start, songEndFrame: end, piece });
    segments = kept.toSorted(
      (left, right) => left.songStartFrame - right.songStartFrame,
    );
  }
  return segments;
};
