import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { type StemType } from '@musetric/audio/es';
import axios from 'axios';

export const getDeliveryAudioContent = async (
  projectId: number,
  stemType: StemType,
) =>
  await requestWithAxios(axios, api.audio.deliveryContent.base, {
    params: {
      projectId,
      stemType,
    },
  });

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

export const getDeliveryAudioWave = async (
  projectId: number,
  stemType: StemType,
) =>
  await requestWithAxios(axios, api.audio.deliveryWave.base, {
    params: {
      projectId,
      stemType,
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
