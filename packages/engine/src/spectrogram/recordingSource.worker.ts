import {
  createMappedSource,
  type SpectrogramSource,
} from '@musetric/spectrogram';
import {
  continuesRun,
  createLiveRun,
  type LiveRun,
  liveRunPieces,
} from '../player/liveTake.cross.js';
import {
  type LiveTakeChunk,
  type LiveTakeStart,
  type PlayerRecordingPiece,
  type RecordingPiecesUpdate,
} from '../player/protocol.cross.js';
import {
  type RecordingPiece,
  toRecordingSegments,
} from '../player/recordingPieces.cross.js';

const toPiece = (piece: PlayerRecordingPiece): RecordingPiece => ({
  songStartFrame: piece.songStartFrame,
  tempo: piece.tempo,
  transpose: piece.transpose,
  octave: piece.octave,
  frameCount: piece.samples.length,
  samples: piece.samples,
});

const buildSource = (
  layers: readonly RecordingPiece[],
  songLength: number,
): SpectrogramSource =>
  createMappedSource(
    toRecordingSegments(layers).map((segment) => ({
      songStartFrame: segment.songStartFrame,
      songEndFrame: segment.songEndFrame,
      rawStartFrame:
        (segment.songStartFrame - segment.piece.songStartFrame) /
        segment.piece.tempo,
      tempo: segment.piece.tempo,
      transpose: segment.piece.transpose + 12 * segment.piece.octave,
      getSamples: () => segment.piece.samples,
    })),
    songLength,
  );

const writePiece = (
  piece: RecordingPiece,
  offset: number,
  samples: Float32Array,
): number => {
  const end = Math.min(piece.frameCount, offset + samples.length);
  if (end > piece.samples.length) {
    const grown = new Float32Array(
      Math.min(piece.frameCount, Math.max(end, piece.samples.length * 2)),
    );
    grown.set(piece.samples);
    piece.samples = grown;
  }
  piece.samples.set(samples.subarray(0, end - offset), offset);
  return end;
};

export type SongRange = {
  frameIndex: number;
  frameCount: number;
};

const toSongRange = (
  piece: RecordingPiece,
  offset: number,
  frameCount: number,
  tempo: number,
): SongRange => ({
  frameIndex: Math.floor(piece.songStartFrame + offset * tempo),
  frameCount: Math.ceil(frameCount * tempo) + 1,
});

export type LiveTakePreview = {
  songFrame: number;
  samples: Float32Array;
};

export type RecordingSource = {
  setPieces: (update: RecordingPiecesUpdate) => void;
  beginLiveTake: (take: LiveTakeStart) => void;
  appendLiveTake: (chunk: LiveTakeChunk) => SongRange | undefined;
  previewLiveTake: (preview: LiveTakePreview) => SongRange | undefined;
  get: (songLength: number) => SpectrogramSource;
  clear: () => void;
};

type SourceRun = LiveRun & {
  writtenFrameCount: number;
  previewEnd: number;
};

type LiveTake = LiveTakeStart & {
  runs: SourceRun[];
};

export const createRecordingSource = (): RecordingSource => {
  let pieces: RecordingPiece[] = [];
  let live: LiveTake | undefined = undefined;
  let cached: { songLength: number; source: SpectrogramSource } | undefined =
    undefined;
  let knownSongLength = 0;

  const reset = () => {
    cached = undefined;
  };

  const openRun = (take: LiveTake, chunk: LiveTakeChunk): SourceRun => {
    const previous = take.runs.at(-1);
    if (previous) {
      previous.piece.frameCount = previous.writtenFrameCount;
    }
    const run: SourceRun = {
      ...createLiveRun(chunk, take.tempo, take.transpose, take.octave),
      writtenFrameCount: 0,
      previewEnd: 0,
    };
    run.piece.frameCount = Math.max(
      0,
      Math.ceil((knownSongLength - run.piece.songStartFrame) / take.tempo),
    );
    take.runs.push(run);
    reset();
    return run;
  };

  return {
    setPieces: (next) => {
      pieces = next.pieces.map(toPiece);
      if (live && (next.switched || live.takeId === next.finishedTakeId)) {
        live = undefined;
      }
      reset();
    },
    beginLiveTake: (take) => {
      if (live?.takeId === take.takeId) {
        return;
      }
      live = { ...take, runs: [] };
      reset();
    },
    appendLiveTake: (chunk) => {
      const take = live;
      if (!take) {
        return undefined;
      }
      const last = take.runs.at(-1);
      const run = continuesRun(last, chunk) ? last : openRun(take, chunk);
      const { piece } = run;
      const offset = chunk.offset - run.firstOffset;
      if (offset >= piece.frameCount) {
        return undefined;
      }
      const end = writePiece(piece, offset, chunk.samples);
      run.writtenFrameCount = Math.max(run.writtenFrameCount, end);
      return toSongRange(piece, offset, chunk.samples.length, take.tempo);
    },
    previewLiveTake: (preview) => {
      const take = live;
      const run = take?.runs.at(-1);
      if (!take || !run) {
        return undefined;
      }
      const { piece } = run;
      const { samples } = preview;
      const placed = Math.round(
        (preview.songFrame - piece.songStartFrame) / take.tempo,
      );
      const start =
        Math.abs(placed - run.previewEnd) <= samples.length / 2
          ? run.previewEnd
          : placed;
      const offset = Math.max(start, run.writtenFrameCount);
      if (offset >= Math.min(piece.frameCount, start + samples.length)) {
        return undefined;
      }
      const end = writePiece(piece, offset, samples.subarray(offset - start));
      run.previewEnd = start + samples.length;
      return toSongRange(piece, offset, end - offset, take.tempo);
    },
    get: (songLength) => {
      knownSongLength = songLength;
      if (cached?.songLength === songLength) {
        return cached.source;
      }
      const layers = live ? [...pieces, ...liveRunPieces(live.runs)] : pieces;
      const source = buildSource(layers, songLength);
      cached = { songLength, source };
      return source;
    },
    clear: () => {
      pieces = [];
      live = undefined;
      reset();
    },
  };
};
