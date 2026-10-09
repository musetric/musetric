import {
  createMappedSource,
  type SpectrogramSource,
} from '@musetric/spectrogram';
import {
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
      getSamples: () => segment.piece.samples,
    })),
    songLength,
  );

type LiveTake = LiveTakeStart & {
  piece?: RecordingPiece;
};

export type SongRange = {
  frameIndex: number;
  frameCount: number;
};

export type RecordingSource = {
  setPieces: (update: RecordingPiecesUpdate) => void;
  beginLiveTake: (take: LiveTakeStart) => void;
  appendLiveTake: (
    frameIndex: number,
    samples: Float32Array,
  ) => SongRange | undefined;
  get: (songLength: number) => SpectrogramSource;
  clear: () => void;
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
      live = { ...take };
      reset();
    },
    appendLiveTake: (frameIndex, samples) => {
      const take = live;
      if (!take) {
        return undefined;
      }
      if (!take.piece) {
        const songStartFrame = take.startFrame ?? frameIndex;
        take.piece = {
          songStartFrame,
          tempo: take.tempo,
          frameCount: Math.max(
            0,
            Math.ceil((knownSongLength - songStartFrame) / take.tempo),
          ),
          samples: new Float32Array(0),
        };
        reset();
      }
      const { piece } = take;
      const offset = frameIndex - piece.songStartFrame;
      if (offset < 0 || offset >= piece.frameCount) {
        return undefined;
      }
      const end = Math.min(piece.frameCount, offset + samples.length);
      if (end > piece.samples.length) {
        const grown = new Float32Array(
          Math.min(piece.frameCount, Math.max(end, piece.samples.length * 2)),
        );
        grown.set(piece.samples);
        piece.samples = grown;
      }
      piece.samples.set(samples.subarray(0, end - offset), offset);
      return {
        frameIndex: Math.floor(piece.songStartFrame + offset * take.tempo),
        frameCount: Math.ceil(samples.length * take.tempo) + 1,
      };
    },
    get: (songLength) => {
      knownSongLength = songLength;
      if (cached?.songLength === songLength) {
        return cached.source;
      }
      const layers = live?.piece ? [...pieces, live.piece] : pieces;
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
