import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { queryOptions } from '@tanstack/react-query';
import axios from 'axios';

export const get = (projectId: number) =>
  queryOptions({
    queryKey: ['rhythm', 'get', projectId],
    queryFn: async () =>
      requestWithAxios(axios, api.rhythm.get.base, {
        params: { projectId },
      }),
    retry: false,
    refetchInterval: (query) => (query.state.data ? false : 5000),
  });
