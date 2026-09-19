import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { queryOptions } from '@tanstack/react-query';
import axios from 'axios';

export const download = () =>
  queryOptions({
    queryKey: ['models', 'download'],
    queryFn: async () => requestWithAxios(axios, api.models.download.base, {}),
  });
