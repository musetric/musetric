import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios, { type AxiosProgressEvent } from 'axios';

export type MixdownUpload = {
  signal: AbortSignal;
  onUploadProgress: (event: AxiosProgressEvent) => void;
};

export const create = async (
  projectId: number,
  data: api.mixdown.create.Request,
  upload: MixdownUpload,
) =>
  requestWithAxios(axios, api.mixdown.create.base, {
    params: { projectId },
    data,
    ...upload,
  });

export const get = async (mixdownId: string, signal: AbortSignal) =>
  requestWithAxios(axios, api.mixdown.get.base, {
    params: { mixdownId },
    signal,
  });

export const remove = async (mixdownId: string) =>
  requestWithAxios(axios, api.mixdown.remove.base, {
    params: { mixdownId },
  });
