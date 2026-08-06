import { join } from 'node:path';
import { app } from 'electron';
import { applyAppPaths } from './appPaths.js';
import { createBackendRunner } from './backendRunner.js';
import { createDesktopLog, reportFatal, watchFatalEvents } from './logging.js';
import { startApp } from './startup.js';
import { createWindows, destroyAllWindows } from './windows.js';

const main = (): void => {
  applyAppPaths();

  const log = createDesktopLog(join(app.getPath('userData'), 'logs'));

  if (!app.requestSingleInstanceLock()) {
    log.logger.info('another instance owns the single instance lock');
    app.exit(0);
    return;
  }

  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('disable-webgpu-blocklist');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  const isMac = process.platform === 'darwin';
  const runner = createBackendRunner();
  let isQuitting = false;
  let isRelaunchRequested = false;

  const shutdown = async (): Promise<void> => {
    if (isQuitting) {
      return;
    }
    isQuitting = true;
    destroyAllWindows();
    await runner.stop();
    app.quit();
  };

  const windows = createWindows({
    onLastClosed: () => {
      if (!isMac) {
        void shutdown();
      }
    },
  });

  const openMainWindow = (): void => {
    const url = runner.url();
    if (isQuitting || url === undefined) {
      return;
    }
    void windows.open(async (window) => window.loadURL(url));
  };

  const requestRelaunch = (): void => {
    if (isRelaunchRequested) {
      return;
    }
    isRelaunchRequested = true;
    app.relaunch();
  };

  watchFatalEvents(log, () => {
    void shutdown();
  });

  const startPromise = app
    .whenReady()
    .then(async () => {
      const result = await startApp({
        log,
        windows,
        runner,
        isQuitting: () => isQuitting,
      });
      if (result === 'storageBusy') {
        await shutdown();
      }
    })
    .catch((error: unknown) => {
      reportFatal(log, 'the app failed to start', error);
      void shutdown();
    });

  app.on('second-instance', () => {
    void startPromise.then(() => {
      if (isQuitting) {
        requestRelaunch();
        return;
      }
      openMainWindow();
    });
  });

  app.on('activate', () => {
    if (windows.isEmpty()) {
      openMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (!isMac) {
      void shutdown();
    }
  });

  app.on('before-quit', (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    void shutdown();
  });
};

main();
