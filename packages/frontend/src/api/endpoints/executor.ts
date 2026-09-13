import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { queryOptions } from '@tanstack/react-query';
import axios from 'axios';

export const get = () =>
  queryOptions({
    queryKey: ['executor', 'get'],
    queryFn: async () => requestWithAxios(axios, api.executor.get.base, {}),
  });
