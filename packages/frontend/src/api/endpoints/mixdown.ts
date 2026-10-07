import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';

export const create = (
  projectId: number,
  renderRecording: () => Promise<File | undefined>,
) =>
  mutationOptions({
    mutationKey: ['mixdown', 'create', projectId],
    mutationFn: async (data: Omit<api.mixdown.create.Request, 'recording'>) =>
      requestWithAxios(axios, api.mixdown.create.base, {
        params: { projectId },
        data: { ...data, recording: await renderRecording() },
      }),
  });
