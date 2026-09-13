import { type api } from '@musetric/api';
import { mountExecutorFrame, unmountExecutorFrame } from './executorFrame.js';

const followVisibility = (url: string): void => {
  const apply = (): void => {
    if (document.visibilityState === 'visible') {
      mountExecutorFrame(url);
      return;
    }
    unmountExecutorFrame();
  };
  document.addEventListener('visibilitychange', apply);
  apply();
};

export const startExecutorSurface = (
  executor: api.executor.get.Response,
): void => {
  if (executor.surface === 'shell') {
    return;
  }
  if (executor.surface === 'page') {
    mountExecutorFrame(executor.url);
    return;
  }
  followVisibility(executor.url);
};
