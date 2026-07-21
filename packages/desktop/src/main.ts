import { setGpuPageHostFactory } from '@musetric/ai/node';
import { app, BrowserWindow } from 'electron';
import { backendUrl, type DesktopBackend, startBackend } from './backend.js';
import { createElectronGpuPage } from './electronGpuHost.js';

app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('disable-webgpu-blocklist');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let backend: DesktopBackend | undefined = undefined;
let stopBackendPromise: Promise<void> | undefined = undefined;
let mainWindow: BrowserWindow | undefined = undefined;
let isQuitting = false;

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

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    mainWindow = undefined;
    if (!isMac) {
      void shutdown();
    }
  });
  await window.loadURL(backendUrl);
};

const start = async (): Promise<void> => {
  setGpuPageHostFactory(createElectronGpuPage);
  backend = await startBackend();
  await createWindow();
  app.on('activate', () => {
    if (mainWindow === undefined) {
      void createWindow();
    }
  });
};

void app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error(error);
    void shutdown();
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
