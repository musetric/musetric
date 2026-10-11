import { type LiveTakeChunk } from './protocol.cross.js';
import { type RecordingPiece } from './recordingPieces.cross.js';

export type LiveRun = {
  startFrame: number;
  firstOffset: number;
  piece: RecordingPiece;
};

export const continuesRun = (
  run: LiveRun | undefined,
  chunk: LiveTakeChunk,
): run is LiveRun =>
  run !== undefined && chunk.offset > 0 && run.startFrame === chunk.startFrame;

export const createLiveRun = (
  chunk: LiveTakeChunk,
  tempo: number,
): LiveRun => ({
  startFrame: chunk.startFrame,
  firstOffset: chunk.offset,
  piece: {
    songStartFrame: chunk.startFrame + chunk.offset * tempo,
    tempo,
    frameCount: 0,
    samples: new Float32Array(0),
  },
});

export const liveRunPieces = (runs: readonly LiveRun[]): RecordingPiece[] =>
  runs.map((run) => run.piece);
