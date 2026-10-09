import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { queryOptions } from '@tanstack/react-query';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';

export const wave = (projectId: number, recordingId: number) =>
  queryOptions({
    queryKey: ['recording', 'wave', projectId, recordingId],
    queryFn: async () =>
      requestWithAxios(axios, api.audio.recordingWave.base, {
        params: { projectId, recordingId },
      }),
  });

export const create = (projectId: number) =>
  mutationOptions({
    mutationKey: ['recording', 'create', projectId],
    mutationFn: async () =>
      requestWithAxios(axios, api.recording.create.base, {
        params: { projectId },
      }),
  });

export type RecordingRename = {
  recordingId: number;
  name: string;
};

export const edit = (projectId: number) =>
  mutationOptions({
    mutationKey: ['recording', 'edit', projectId],
    mutationFn: async (data: RecordingRename) =>
      requestWithAxios(axios, api.recording.edit.base, {
        params: { projectId, recordingId: data.recordingId },
        data: { name: data.name },
      }),
  });

export const activate = (projectId: number) =>
  mutationOptions({
    mutationKey: ['recording', 'activate', projectId],
    mutationFn: async (recordingId: number) =>
      requestWithAxios(axios, api.recording.activate.base, {
        params: { projectId, recordingId },
      }),
  });

export const remove = (projectId: number) =>
  mutationOptions({
    mutationKey: ['recording', 'remove', projectId],
    mutationFn: async (recordingId: number) =>
      requestWithAxios(axios, api.recording.remove.base, {
        params: { projectId, recordingId },
      }),
  });
