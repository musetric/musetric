export type RecordingPiece = {
  songStartFrame: number;
  tempo: number;
  frameCount: number;
  samples: Float32Array;
};

export const pieceSongEnd = (piece: RecordingPiece): number =>
  piece.songStartFrame + piece.frameCount * piece.tempo;

export type RecordingSegment = {
  songStartFrame: number;
  songEndFrame: number;
  piece: RecordingPiece;
};

export const toRecordingSegments = (
  pieces: readonly RecordingPiece[],
): RecordingSegment[] => {
  let segments: RecordingSegment[] = [];
  for (const piece of pieces) {
    const start = piece.songStartFrame;
    const end = pieceSongEnd(piece);
    if (end <= start) {
      continue;
    }
    const kept: RecordingSegment[] = [];
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

export const firstSegmentEndingAfter = (
  segments: readonly RecordingSegment[],
  songFrame: number,
): number => {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle].songEndFrame <= songFrame) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};
