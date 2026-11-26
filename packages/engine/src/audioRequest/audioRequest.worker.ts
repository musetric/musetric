import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { type StemType } from '@musetric/audio/es';
import axios from 'axios';

type ByteRange = {
  from: number;
  to: number | undefined;
  signal?: AbortSignal;
};

const getRange = async (
  url: string,
  name: string,
  bytes: ByteRange,
): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  const { from, to, signal } = bytes;
  const response = await fetch(url, {
    signal,
    headers: {
      range:
        to === undefined
          ? `bytes=${String(from)}-`
          : `bytes=${String(from)}-${String(to - 1)}`,
    },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (response.status !== 206) {
    throw new Error(`${name} answered ${response.status} to a range`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

export const getMasterAudioRange = async (
  projectId: number,
  type: StemType,
  from: number,
  to: number | undefined,
): Promise<Uint8Array> => {
  const name = `The ${type} master of project ${projectId}`;
  const bytes = await getRange(
    api.audio.masterContent.base.endpoint({ projectId, type }),
    name,
    { from, to },
  );
  if (!bytes) {
    throw new Error(`${name} is not found`);
  }
  return bytes;
};

export type RecordingPieceRange = ByteRange & {
  projectId: number;
  recordingId: number;
  blobId: string;
};

export const getRecordingPieceRange = async (
  range: RecordingPieceRange,
): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  const { projectId, recordingId, blobId } = range;
  return await getRange(
    api.audio.recordingPiece.base.endpoint({ projectId, recordingId, blobId }),
    `The piece ${blobId} of recording ${recordingId}`,
    range,
  );
};

export const getRecordingList = async (projectId: number) =>
  await requestWithAxios(axios, api.recording.list.base, {
    params: {
      projectId,
    },
  });

export const getRecordingPieces = async (
  projectId: number,
  recordingId: number,
) =>
  await requestWithAxios(axios, api.audio.recordingPieces.base, {
    params: {
      projectId,
      recordingId,
    },
  });

export const getMasterWave = async (projectId: number, type: StemType) =>
  await requestWithAxios(axios, api.audio.masterWave.base, {
    params: {
      projectId,
      type,
    },
  });

export const getRecordingAudioWave = async (
  projectId: number,
  recordingId: number,
) =>
  await requestWithAxios(axios, api.audio.recordingWave.base, {
    params: {
      projectId,
      recordingId,
    },
  });
