import {
  getRecordingPieceRange,
  getRecordingPieces,
} from '../audioRequest/audioRequest.worker.js';
import { type PlayerRecordingPiece } from '../player/protocol.cross.js';
import {
  type HeldTake,
  takePageFrameCount,
  takePageStarts,
} from './takePages.worker.js';
import { type TakeSource } from './takeTracks.worker.js';

const wavHeaderByteLength = 44;
const wavSampleByteLength = 2;
const wavFullScale = 32768;

export type StoredPiece = {
  blobId: string;
  songStartFrame: number;
  tempo: number;
  transpose: number;
  octave: number;
  frameCount: number;
};

export type StoredRecording = {
  recordingId: number | undefined;
  pieces: StoredPiece[];
};

export type RecordingPlace = {
  projectId: number;
  sampleRate: number;
};

export const loadStored = async (
  place: RecordingPlace,
  recordingId: number | undefined,
): Promise<StoredRecording> => {
  if (recordingId === undefined) {
    return { recordingId, pieces: [] };
  }
  const { pieces } = await getRecordingPieces(place.projectId, recordingId);
  return {
    recordingId,
    pieces: pieces.map((piece) => {
      if (piece.sampleRate !== place.sampleRate) {
        throw new Error(
          `A piece of the recording is at ${String(piece.sampleRate)} Hz, the player at ${String(place.sampleRate)} Hz`,
        );
      }
      return {
        blobId: piece.blobId,
        songStartFrame: piece.songStartFrame,
        tempo: piece.tempo,
        transpose: piece.transpose,
        octave: piece.octave,
        frameCount: piece.frameCount,
      };
    }),
  };
};

const toSamples = (
  bytes: Uint8Array<ArrayBuffer>,
  frameCount: number,
): Float32Array<ArrayBuffer> => {
  if (bytes.byteLength < frameCount * wavSampleByteLength) {
    throw new Error('A piece of the recording is shorter than its frames');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] =
      view.getInt16(index * wavSampleByteLength, true) / wavFullScale;
  }
  return samples;
};

export type StoredFrames = {
  from: number;
  to: number;
  signal?: AbortSignal;
};

const readStored = async (
  place: RecordingPlace & StoredRecording,
  piece: StoredPiece,
  frames: StoredFrames,
): Promise<Float32Array<ArrayBuffer> | undefined> => {
  const { recordingId } = place;
  if (recordingId === undefined) {
    return undefined;
  }
  const bytes = await getRecordingPieceRange({
    projectId: place.projectId,
    recordingId,
    blobId: piece.blobId,
    from: wavHeaderByteLength + frames.from * wavSampleByteLength,
    to: wavHeaderByteLength + frames.to * wavSampleByteLength,
    signal: frames.signal,
  });
  return bytes && toSamples(bytes, frames.to - frames.from);
};

const pageFrames = (index: number, frameCount: number, sampleRate: number) => {
  const from = index * takePageFrameCount(sampleRate);
  return {
    from,
    to: Math.min(frameCount, from + takePageFrameCount(sampleRate)),
  };
};

export const storedSources = (
  place: RecordingPlace & StoredRecording,
): TakeSource[] =>
  place.pieces.map((piece) => ({
    key: `blob:${piece.blobId}`,
    songStartFrame: piece.songStartFrame,
    tempo: piece.tempo,
    transpose: piece.transpose,
    octave: piece.octave,
    frameCount: piece.frameCount,
    pageStarts: takePageStarts(piece.frameCount, place.sampleRate),
    read: async (index, signal) => {
      const frames = pageFrames(index, piece.frameCount, place.sampleRate);
      const samples = await readStored(place, piece, { ...frames, signal });
      if (!samples) {
        throw new Error(`The piece ${piece.blobId} of the recording is gone`);
      }
      return samples;
    },
  }));

export const heldSources = (take: HeldTake, sampleRate: number): TakeSource[] =>
  take.runs.flatMap((run, runIndex) =>
    run.frameCount > 0
      ? [
          {
            key: `take:${take.takeId}:${String(runIndex)}`,
            songStartFrame: run.startFrame,
            tempo: take.tempo,
            transpose: take.transpose,
            octave: take.octave,
            frameCount: run.frameCount,
            pageStarts: takePageStarts(run.frameCount, sampleRate),
            read: async (index) => {
              const frames = pageFrames(index, run.frameCount, sampleRate);
              return Promise.resolve(
                take.read(runIndex, frames.from, frames.to),
              );
            },
          },
        ]
      : [],
  );

const wholePiece = (
  piece: StoredPiece,
  samples: Float32Array<ArrayBuffer>,
): PlayerRecordingPiece => ({
  songStartFrame: piece.songStartFrame,
  tempo: piece.tempo,
  transpose: piece.transpose,
  octave: piece.octave,
  samples: samples.slice(),
});

type LoadedWhole = {
  piece: StoredPiece;
  samples: Float32Array<ArrayBuffer>;
};

export type StoredWholes = {
  load: (
    place: RecordingPlace & StoredRecording,
  ) => Promise<PlayerRecordingPiece[]>;
  copy: (pieces: readonly StoredPiece[]) => PlayerRecordingPiece[];
};

export const createStoredWholes = (): StoredWholes => {
  let wholes = new Map<string, Float32Array<ArrayBuffer>>();
  return {
    load: async (place) => {
      const loaded = await Promise.all(
        place.pieces.map(async (piece): Promise<LoadedWhole | undefined> => {
          const samples =
            wholes.get(piece.blobId) ??
            (await readStored(place, piece, { from: 0, to: piece.frameCount }));
          return samples && { piece, samples };
        }),
      );
      const present = loaded.flatMap((found) => (found ? [found] : []));
      wholes = new Map(
        present.map((found) => [found.piece.blobId, found.samples]),
      );
      return present.map((found) => wholePiece(found.piece, found.samples));
    },
    copy: (pieces) =>
      pieces.flatMap((piece) => {
        const samples = wholes.get(piece.blobId);
        return samples ? [wholePiece(piece, samples)] : [];
      }),
  };
};
