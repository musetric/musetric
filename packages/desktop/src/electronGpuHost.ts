import { type OpenGpuPage } from '@musetric/server';
import { BrowserWindow } from 'electron';

const createHiddenWindow = (partition: string): BrowserWindow =>
  new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition,
    },
  });

const destroyWindow = async (window: BrowserWindow): Promise<void> => {
  if (window.isDestroyed()) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    window.once('closed', resolve);
  });
  window.destroy();
  await closed;
};

export const createElectronPageOpener = (): OpenGpuPage => {
  let nextPageId = 0;
  return async (url) => {
    const window = createHiddenWindow(`musetric-gpu-${nextPageId++}`);
    try {
      await window.loadURL(url);
      return { close: async () => destroyWindow(window) };
    } catch (error) {
      await destroyWindow(window);
      throw error;
    }
  };
};
