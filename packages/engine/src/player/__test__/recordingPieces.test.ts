import { describe, expect, it } from 'vitest';
import {
  firstSegmentEndingAfter,
  type RecordingPiece,
  toRecordingSegments,
} from '../recordingPieces.cross.js';

const piece = (
  songStartFrame: number,
  frameCount: number,
  tempo: number,
): RecordingPiece => ({
  songStartFrame,
  tempo,
  frameCount,
  samples: new Float32Array(frameCount),
});

const spans = (pieces: RecordingPiece[]) =>
  toRecordingSegments(pieces).map((segment) => [
    segment.songStartFrame,
    segment.songEndFrame,
    pieces.indexOf(segment.piece),
  ]);

describe('recording pieces', () => {
  it('lets a later piece cover the middle of an earlier one', () => {
    expect(spans([piece(0, 100, 1), piece(40, 40, 0.5)])).toEqual([
      [0, 40, 0],
      [40, 60, 1],
      [60, 100, 0],
    ]);
  });

  it('keeps pieces apart when they do not touch', () => {
    expect(spans([piece(50, 10, 2), piece(0, 10, 1)])).toEqual([
      [0, 10, 1],
      [50, 70, 0],
    ]);
  });

  it('finds the segment that sounds at a song frame', () => {
    const segments = toRecordingSegments([piece(0, 10, 1), piece(20, 10, 1)]);
    expect(firstSegmentEndingAfter(segments, 5)).toBe(0);
    expect(firstSegmentEndingAfter(segments, 15)).toBe(1);
    expect(firstSegmentEndingAfter(segments, 35)).toBe(2);
  });
});
