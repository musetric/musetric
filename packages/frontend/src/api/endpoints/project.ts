import { api } from '@musetric/api';
import { requestWithAxios, subscribeEventSource } from '@musetric/api/dom';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import axios from 'axios';
import { mutationOptions } from '../queryClient.js';

export const list = () =>
  queryOptions({
    queryKey: ['project', 'list'],
    queryFn: async () => requestWithAxios(axios, api.project.list.base, {}),
  });

export const get = (projectId: number) =>
  queryOptions({
    queryKey: ['project', 'get', projectId],
    queryFn: async () =>
      requestWithAxios(axios, api.project.get.base, {
        params: { projectId },
      }),
  });

export const subscribeToStatus = (queryClient: QueryClient) =>
  subscribeEventSource(api.project.status.event, (event) => {
    const applyEvent = (projectItem: api.project.Item): api.project.Item => ({
      ...projectItem,
      processing: event.processing,
    });

    queryClient.setQueryData(list().queryKey, (projects) => {
      if (!projects) {
        return projects;
      }
      return projects.map((projectItem) =>
        projectItem.id === event.projectId
          ? applyEvent(projectItem)
          : projectItem,
      );
    });

    queryClient.setQueryData(get(event.projectId).queryKey, (projectItem) => {
      if (!projectItem) {
        return projectItem;
      }
      return applyEvent(projectItem);
    });

    if (event.processing.done) {
      void queryClient.invalidateQueries({
        queryKey: get(event.projectId).queryKey,
      });
      void queryClient.invalidateQueries({ queryKey: list().queryKey });
    }
  });

export const create = (queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: ['project', 'create'],
    mutationFn: async (data: api.project.create.Request) =>
      requestWithAxios(axios, api.project.create.base, {
        data,
      }),
    onSuccess: (newProject) => {
      queryClient.setQueryData(list().queryKey, (projects = []) => [
        newProject,
        ...projects,
      ]);
    },
  });

export const edit = (queryClient: QueryClient, projectId: number) =>
  mutationOptions({
    mutationKey: ['project', 'edit', projectId],
    mutationFn: async (data: api.project.edit.Request) =>
      requestWithAxios(axios, api.project.edit.base, {
        params: { projectId },
        data,
      }),
    onSuccess: (newProject) => {
      queryClient.setQueryData(list().queryKey, (projects) =>
        projects?.map((x) => (x.id === newProject.id ? newProject : x)),
      );
    },
  });

export const remove = (queryClient: QueryClient, projectId: number) =>
  mutationOptions({
    mutationKey: ['project', 'remove', projectId],
    mutationFn: async () =>
      requestWithAxios(axios, api.project.remove.base, {
        params: { projectId },
      }),
    onSuccess: () => {
      queryClient.setQueryData(list().queryKey, (projects) =>
        projects?.filter((x) => x.id !== projectId),
      );
    },
  });
