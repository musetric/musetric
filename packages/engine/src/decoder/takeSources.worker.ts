import { type api } from '@musetric/api';
import {
  getRecordingPieceRange,
  getRecordingPieces,
} from '../audioRequest/audioRequest.worker.js';
import { type PlayerRecordingPiece } from '../player/protocol.cross.js';
import { type HeldTake, takePageFrameCount } from './takePages.worker.js';
import { type TakeSource } from './takeTracks.worker.js';

const wavHeaderByteLength = 44;
const wavSampleByteLength = 2;
const wavFullScale = 32768;

type StoredPiece = api.audio.recordingPieces.Response['pieces'][number];

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
  const other = pieces.find((piece) => piece.sampleRate !== place.sampleRate);
  if (other) {
    throw new Error(
      `A piece of the recording is at ${String(other.sampleRate)} Hz, the player at ${String(place.sampleRate)} Hz`,
    );
  }
  return { recordingId, pieces };
};

type StoredPlace = RecordingPlace & StoredRecording;

type StoredFrames = {
  from: number;
  to: number;
  signal?: AbortSignal;
};

const readStored = async (
  place: StoredPlace,
  piece: StoredPiece,
  frames: StoredFrames,
): Promise<Float32Array<ArrayBuffer> | undefined> => {
  if (place.recordingId === undefined) {
    return undefined;
  }
  const bytes = await getRecordingPieceRange({
    projectId: place.projectId,
    recordingId: place.recordingId,
    blobId: piece.blobId,
    from: wavHeaderByteLength + frames.from * wavSampleByteLength,
    to: wavHeaderByteLength + frames.to * wavSampleByteLength,
    signal: frames.signal,
  });
  const frameCount = frames.to - frames.from;
  if (!bytes || bytes.byteLength < frameCount * wavSampleByteLength) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] =
      view.getInt16(index * wavSampleByteLength, true) / wavFullScale;
  }
  return samples;
};

const pagedSource = (
  source: Omit<TakeSource, 'pageStarts' | 'read'>,
  sampleRate: number,
  read: (
    from: number,
    to: number,
    signal: AbortSignal,
  ) => Promise<Float32Array<ArrayBuffer>>,
): TakeSource => {
  const step = takePageFrameCount(sampleRate);
  return {
    ...source,
    pageStarts: Array.from(
      { length: Math.ceil(source.frameCount / step) },
      (_, index) => index * step,
    ),
    read: async (index, signal) => {
      const from = index * step;
      const to = Math.min(source.frameCount, from + step);
      const samples = await read(from, to, signal);
      return { index, startFrame: from, frameCount: to - from, samples };
    },
  };
};

export const storedSources = (place: StoredPlace): TakeSource[] =>
  place.pieces.map((piece) =>
    pagedSource(
      {
        key: `blob:${piece.blobId}`,
        songStartFrame: piece.songStartFrame,
        tempo: piece.tempo,
        transpose: piece.transpose,
        octave: piece.octave,
        frameCount: piece.frameCount,
      },
      place.sampleRate,
      async (from, to, signal) => {
        const samples = await readStored(place, piece, { from, to, signal });
        if (!samples) {
          throw new Error(`The piece ${piece.blobId} of the recording is gone`);
        }
        return samples;
      },
    ),
  );

export const heldSources = (take: HeldTake, sampleRate: number): TakeSource[] =>
  take.runs.map((run, runIndex) =>
    pagedSource(
      {
        key: `take:${take.takeId}:${String(runIndex)}`,
        songStartFrame: run.startFrame,
        tempo: take.tempo,
        transpose: take.transpose,
        octave: take.octave,
        frameCount: run.frameCount,
      },
      sampleRate,
      async (from, to) => Promise.resolve(take.read(runIndex, from, to)),
    ),
  );

export type StoredWholes = {
  load: (place: StoredPlace) => Promise<PlayerRecordingPiece[]>;
  copy: (pieces: readonly StoredPiece[]) => PlayerRecordingPiece[];
};

export const createStoredWholes = (): StoredWholes => {
  let wholes = new Map<string, Float32Array<ArrayBuffer>>();
  const copy: StoredWholes['copy'] = (pieces) =>
    pieces.flatMap((piece) => {
      const samples = wholes.get(piece.blobId);
      return samples ? [{ ...piece, samples: samples.slice() }] : [];
    });
  return {
    load: async (place) => {
      const loaded = await Promise.all(
        place.pieces.map(
          async (piece) =>
            wholes.get(piece.blobId) ??
            (await readStored(place, piece, { from: 0, to: piece.frameCount })),
        ),
      );
      wholes = new Map();
      for (const [index, piece] of place.pieces.entries()) {
        const samples = loaded[index];
        if (samples) {
          wholes.set(piece.blobId, samples);
        }
      }
      return copy(place.pieces);
    },
    copy,
  };
};
