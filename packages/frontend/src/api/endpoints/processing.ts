import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';
import * as project from './project.js';

export const get = () =>
  queryOptions({
    queryKey: ['processing', 'get'],
    queryFn: async () => requestWithAxios(axios, api.processing.get.base, {}),
  });

export const pause = (queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: ['processing', 'pause'],
    mutationFn: async (data: api.processing.pause.Request) => {
      await requestWithAxios(axios, api.processing.pause.base, { data });
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(get().queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ['project'] });
    },
  });

export const order = (queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: ['processing', 'order'],
    mutationFn: async (data: api.processing.order.Request) =>
      requestWithAxios(axios, api.processing.order.base, { data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: project.list().queryKey });
    },
  });

export const pauseProject = (queryClient: QueryClient, projectId: number) =>
  mutationOptions({
    mutationKey: ['processing', 'pauseProject', projectId],
    mutationFn: async (data: api.project.pause.Request) => {
      await requestWithAxios(axios, api.project.pause.base, {
        params: { projectId },
        data,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(project.list().queryKey, (projects) =>
        projects?.map((item) =>
          item.id === projectId ? { ...item, paused: data.paused } : item,
        ),
      );
      queryClient.setQueryData(
        project.get(projectId).queryKey,
        (projectItem) =>
          projectItem ? { ...projectItem, paused: data.paused } : projectItem,
      );
    },
  });
