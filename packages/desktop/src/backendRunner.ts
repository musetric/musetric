import { type MigrationReport } from '@musetric/backend-db/migrations';

export type DesktopBackend = {
  url: string;
  migration: MigrationReport;
  close: () => Promise<void>;
};

export type BackendRunner = {
  set: (backend: DesktopBackend) => void;
  url: () => string | undefined;
  stop: () => Promise<void>;
};

export const createBackendRunner = (): BackendRunner => {
  let current: DesktopBackend | undefined = undefined;
  let stopping: Promise<void> | undefined = undefined;

  const stop = async (): Promise<void> => {
    if (stopping !== undefined) {
      await stopping;
      return;
    }
    if (current === undefined) {
      return;
    }
    const active = current;
    current = undefined;
    stopping = active.close();
    await stopping;
  };

  return {
    set: (backend) => {
      current = backend;
    },
    url: () => current?.url,
    stop,
  };
};
