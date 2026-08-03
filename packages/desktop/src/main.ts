import { app, BrowserWindow, dialog } from 'electron';
import { applyAppPaths } from './appPaths.js';
import { type DesktopBackend, startBackend } from './backend.js';
import { createElectronGpuHost } from './electronGpuHost.js';

const main = (): void => {
  applyAppPaths();

  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }

  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('disable-webgpu-blocklist');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  let backend: DesktopBackend | undefined = undefined;
  let stopBackendPromise: Promise<void> | undefined = undefined;
  let isQuitting = false;
  let isRelaunchRequested = false;
  const mainWindows = new Set<BrowserWindow>();

  const isMac = process.platform === 'darwin';

  const stopBackend = async (): Promise<void> => {
    if (stopBackendPromise !== undefined) {
      await stopBackendPromise;
      return;
    }
    if (backend === undefined) {
      return;
    }
    const activeBackend = backend;
    backend = undefined;
    stopBackendPromise = activeBackend.close();
    await stopBackendPromise;
  };

  const destroyAllWindows = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
  };

  const shutdown = async (): Promise<void> => {
    if (isQuitting) {
      return;
    }
    isQuitting = true;
    destroyAllWindows();
    await stopBackend();
    app.quit();
  };

  const createWindow = async (url: string): Promise<void> => {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindows.add(window);
    window.on('closed', () => {
      mainWindows.delete(window);
      if (!isMac && mainWindows.size === 0) {
        void shutdown();
      }
    });
    await window.loadURL(url);
  };

  const openMainWindow = (): void => {
    if (isQuitting || backend === undefined) {
      return;
    }
    void createWindow(backend.url);
  };

  const requestRelaunch = (): void => {
    if (isRelaunchRequested) {
      return;
    }
    isRelaunchRequested = true;
    app.relaunch();
  };

  const start = async (): Promise<void> => {
    const activeBackend = await startBackend({
      gpuPageHostFactory: createElectronGpuHost(),
    });
    if (activeBackend === undefined) {
      dialog.showErrorBox(
        'Musetric is already running',
        'Another Musetric process is using the same data folder. Close it and try again.',
      );
      await shutdown();
      return;
    }
    backend = activeBackend;
    await createWindow(activeBackend.url);
  };

  const startPromise = app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error(error);
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
    if (mainWindows.size === 0) {
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
