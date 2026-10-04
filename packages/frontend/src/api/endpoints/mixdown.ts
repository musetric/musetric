import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';

export const create = (projectId: number) =>
  mutationOptions({
    mutationKey: ['mixdown', 'create', projectId],
    mutationFn: async (data: api.mixdown.create.Request) =>
      requestWithAxios(axios, api.mixdown.create.base, {
        params: { projectId },
        data,
      }),
  });
