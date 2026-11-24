import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { type StemType } from '@musetric/audio/es';
import axios from 'axios';

type MasterAudioRange = {
  projectId: number;
  type: StemType;
  from: number;
  to: number | undefined;
  signal?: AbortSignal;
};

export const getMasterAudioRange = async (
  range: MasterAudioRange,
): Promise<Uint8Array> => {
  const { projectId, type, from, to, signal } = range;
  const response = await fetch(
    api.audio.masterContent.base.endpoint({ projectId, type }),
    {
      signal,
      headers: {
        range:
          to === undefined
            ? `bytes=${String(from)}-`
            : `bytes=${String(from)}-${String(to - 1)}`,
      },
    },
  );
  if (response.status !== 206) {
    throw new Error(
      `The ${type} master of project ${projectId} answered ${response.status} to a range`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
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

export const getRecordingPiece = async (
  projectId: number,
  recordingId: number,
  blobId: string,
) =>
  await requestWithAxios(axios, api.audio.recordingPiece.base, {
    params: {
      projectId,
      recordingId,
      blobId,
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
