import { describe, expect, it } from 'vitest';
import { createRecordingSource } from '../recordingSource.worker.js';

const ramp = (length: number, from: number): Float32Array<ArrayBuffer> =>
  Float32Array.from({ length }, (_, index) => from + index);

const read = (
  source: ReturnType<ReturnType<typeof createRecordingSource>['get']>,
  from: number,
  count: number,
): number[] => {
  const target = new Float32Array(count);
  source.read(target, 0, from, count);
  return Array.from(target);
};

describe('recording source', () => {
  it('maps a slow piece onto the song from its raw samples', () => {
    const recording = createRecordingSource();
    recording.setPieces({
      pieces: [{ songStartFrame: 4, tempo: 0.5, samples: ramp(8, 10) }],
    });
    const source = recording.get(12);
    expect(source.position(4)).toBe(4);
    expect(source.position(6)).toBe(8);
    expect(read(source, 4, 8)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('keeps a live take in place while it grows and reports the song it covers', () => {
    const recording = createRecordingSource();
    recording.setPieces({
      pieces: [{ songStartFrame: 0, tempo: 1, samples: ramp(20, 100) }],
    });
    recording.get(20);
    recording.beginLiveTake({ takeId: 'take', tempo: 0.5 });
    const first = recording.appendLiveTake(10, ramp(4, 1));
    const source = recording.get(20);
    const second = recording.appendLiveTake(14, ramp(4, 5));
    expect(recording.get(20)).toBe(source);
    expect(first).toEqual({ frameIndex: 10, frameCount: 3 });
    expect(second).toEqual({ frameIndex: 12, frameCount: 3 });
    expect(read(source, 8, 10)).toEqual([108, 109, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('drops the live take once its pieces arrive', () => {
    const recording = createRecordingSource();
    recording.get(20);
    recording.beginLiveTake({ takeId: 'take', tempo: 1 });
    recording.appendLiveTake(0, ramp(4, 1));
    recording.setPieces({ pieces: [], finishedTakeId: 'take' });
    expect(read(recording.get(20), 0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a live take of another session until the pieces switch recordings', () => {
    const recording = createRecordingSource();
    recording.get(20);
    recording.beginLiveTake({ takeId: 'take', tempo: 1 });
    recording.appendLiveTake(0, ramp(4, 1));
    recording.setPieces({ pieces: [], finishedTakeId: 'other' });
    expect(read(recording.get(20), 0, 4)).toEqual([1, 2, 3, 4]);
    recording.setPieces({
      pieces: [{ songStartFrame: 2, tempo: 1, samples: ramp(2, 50) }],
      switched: true,
    });
    expect(read(recording.get(20), 0, 4)).toEqual([0, 0, 50, 51]);
  });

  it('places a live take joined late at its start and ignores frames past the song', () => {
    const recording = createRecordingSource();
    recording.get(20);
    recording.beginLiveTake({ takeId: 'take', tempo: 0.5, startFrame: 4 });
    recording.appendLiveTake(8, ramp(4, 1));
    const late = recording.appendLiveTake(44, ramp(4, 1));
    expect(late).toBeUndefined();
    expect(read(recording.get(20), 4, 8)).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
});
