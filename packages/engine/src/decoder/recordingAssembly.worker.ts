import { type AudioDecoder } from '@musetric/audio/decoder';
import { isAxiosError } from 'axios';
import {
  getRecordingPiece,
  getRecordingPieces,
} from '../audioRequest/audioRequest.worker.js';
import { type PlayerRecordingPiece } from '../player/protocol.cross.js';

export const copyPieces = (
  pieces: readonly PlayerRecordingPiece[],
): PlayerRecordingPiece[] =>
  pieces.map((piece) => ({ ...piece, samples: piece.samples.slice() }));

const loadAttempts = 3;

const isMissing = (error: unknown): boolean =>
  isAxiosError(error) && error.response?.status === 404;

type LoadedPiece = {
  songStartFrame: number;
  tempo: number;
  transpose: number;
  octave: number;
  blobId: string;
  samples: Float32Array<ArrayBuffer> | undefined;
};

export type RecordingAssembly = {
  load: (
    projectId: number,
    recordingId: number,
  ) => Promise<PlayerRecordingPiece[]>;
};

export const createRecordingAssembly = (
  sampleRate: number,
  decoder: AudioDecoder,
): RecordingAssembly => {
  let decoded = new Map<string, Float32Array<ArrayBuffer>>();

  const decode = async (
    projectId: number,
    recordingId: number,
    blobId: string,
  ): Promise<Float32Array<ArrayBuffer> | undefined> => {
    const cached = decoded.get(blobId);
    if (cached) {
      return cached;
    }
    try {
      const content = await getRecordingPiece(projectId, recordingId, blobId);
      if (content.buffer.byteLength === 0) {
        return new Float32Array(0);
      }
      const { channels } = await decoder.decode(content.buffer, {
        extension: 'wav',
        sampleRate,
        keepChannels: true,
      });
      return channels[0];
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }
      throw error;
    }
  };

  const loadOnce = async (
    projectId: number,
    recordingId: number,
  ): Promise<LoadedPiece[]> => {
    const { pieces } = await getRecordingPieces(projectId, recordingId);
    return await Promise.all(
      pieces.map(async (piece) => ({
        songStartFrame: (piece.songStartFrame * sampleRate) / piece.sampleRate,
        tempo: piece.tempo,
        transpose: piece.transpose,
        octave: piece.octave,
        blobId: piece.blobId,
        samples: await decode(projectId, recordingId, piece.blobId),
      })),
    );
  };

  return {
    load: async (projectId, recordingId) => {
      let loaded = await loadOnce(projectId, recordingId);
      for (
        let attempt = 1;
        attempt < loadAttempts && loaded.some((piece) => !piece.samples);
        attempt += 1
      ) {
        loaded = await loadOnce(projectId, recordingId);
      }
      const present = loaded.flatMap((piece) =>
        piece.samples ? [{ ...piece, samples: piece.samples }] : [],
      );
      decoded = new Map(present.map((piece) => [piece.blobId, piece.samples]));
      return present.map((piece) => ({
        songStartFrame: piece.songStartFrame,
        tempo: piece.tempo,
        transpose: piece.transpose,
        octave: piece.octave,
        samples: piece.samples,
      }));
    },
  };
};
