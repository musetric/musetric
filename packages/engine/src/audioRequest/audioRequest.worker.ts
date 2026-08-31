import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { type StemType } from '@musetric/audio/es';
import axios from 'axios';
import { getWorkerBackendUrlHash } from '../common/workerBackendUrl.cross.js';

const backendUrl = getWorkerBackendUrlHash();
if (backendUrl) {
  axios.defaults.baseURL = backendUrl;
}

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

export const getRecordingAudioContent = async (projectId: number) =>
  await requestWithAxios(axios, api.audio.recordingContent.base, {
    params: {
      projectId,
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

export const getRecordingAudioWave = async (projectId: number) =>
  await requestWithAxios(axios, api.audio.recordingWave.base, {
    params: {
      projectId,
    },
  });
