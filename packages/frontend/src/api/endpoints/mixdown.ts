import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';

type MixdownCreation = {
  request: Omit<api.mixdown.create.Request, 'recording'>;
  renderRecording: () => Promise<File | undefined>;
};

export const create = (projectId: number) =>
  mutationOptions({
    mutationKey: ['mixdown', 'create', projectId],
    mutationFn: async (creation: MixdownCreation) =>
      requestWithAxios(axios, api.mixdown.create.base, {
        params: { projectId },
        data: {
          ...creation.request,
          recording: await creation.renderRecording(),
        },
      }),
  });
