import { type api } from '@musetric/api';
import { type QueryClient } from '@tanstack/react-query';
import { endpoints } from '../api/index.js';

const isWorking = (projects: api.project.Item[] | undefined): boolean =>
  (projects ?? []).some((project) =>
    Object.values(project.processing.steps).some(
      (step) => step.status === 'processing',
    ),
  );

const readWakeLock = (): WakeLock | undefined =>
  'wakeLock' in navigator ? navigator.wakeLock : undefined;

export const holdScreenWhileWorking = (queryClient: QueryClient): void => {
  const wakeLock = readWakeLock();
  if (!wakeLock) {
    return;
  }
  let held: WakeLockSentinel | undefined = undefined;
  let pending = false;

  const apply = async (working: boolean): Promise<void> => {
    if (working === (held !== undefined) || pending) {
      return;
    }
    pending = true;
    try {
      if (working) {
        held = await wakeLock.request('screen');
        held.addEventListener('release', () => {
          held = undefined;
        });
        return;
      }
      const releasing = held;
      held = undefined;
      await releasing?.release();
    } catch {
      held = undefined;
    } finally {
      pending = false;
    }
  };

  queryClient.getQueryCache().subscribe(() => {
    const projects = queryClient.getQueryData(
      endpoints.project.list().queryKey,
    );
    void apply(isWorking(projects));
  });
};
