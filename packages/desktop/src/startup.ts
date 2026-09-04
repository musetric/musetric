import { fileURLToPath } from 'node:url';
import { dialog } from 'electron';
import { type BackendRunner } from './backendRunner.js';
import { type DesktopLog } from './logging.js';
import { type Windows } from './windows.js';

const loadingPath = fileURLToPath(new URL('./loading.html', import.meta.url));

export type StartAppOptions = {
  log: DesktopLog;
  windows: Windows;
  runner: BackendRunner;
  isQuitting: () => boolean;
};

export type StartAppResult = 'started' | 'storageBusy';

export const startApp = async (
  options: StartAppOptions,
): Promise<StartAppResult> => {
  const { log, windows, runner, isQuitting } = options;

  const window = await windows.open(async (loadingWindow) =>
    loadingWindow.loadFile(loadingPath),
  );

  const { startBackend } = await import('./backend.js');
  const backend = await startBackend({ logger: log.logger });
  if (backend === undefined) {
    log.logger.error('the storage lock is held by another process');
    dialog.showErrorBox(
      'Musetric is already running',
      'Another Musetric process is using the same data folder. Close it and try again.',
    );
    return 'storageBusy';
  }
  runner.set(backend);
  log.logger.info(
    { ...backend.migration },
    `database schema v${String(backend.migration.fromVersion)} -> v${String(backend.migration.toVersion)}`,
  );

  if (isQuitting() || window.isDestroyed()) {
    return 'started';
  }
  await window.loadURL(backend.url);
  return 'started';
};
