import { BrowserWindow } from 'electron';

const windowBackgroundColor = '#121212';

const waitForFrames = async (window: BrowserWindow): Promise<void> => {
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );
};

const whenPainted = async (window: BrowserWindow): Promise<void> =>
  new Promise((resolve) => {
    window.once('ready-to-show', () => {
      resolve();
    });
    window.once('closed', () => {
      resolve();
    });
  });

const reveal = async (
  window: BrowserWindow,
  painted: Promise<void>,
): Promise<void> => {
  await painted;
  if (window.isDestroyed()) {
    return;
  }
  window.show();
  await waitForFrames(window);
  if (window.isDestroyed()) {
    return;
  }
  window.setOpacity(1);
};

export type LoadWindow = (window: BrowserWindow) => Promise<void>;

export type Windows = {
  open: (load: LoadWindow) => Promise<BrowserWindow>;
  isEmpty: () => boolean;
};

export type CreateWindowsOptions = {
  onLastClosed: () => void;
};

export const createWindows = (options: CreateWindowsOptions): Windows => {
  const opened = new Set<BrowserWindow>();

  const open = async (load: LoadWindow): Promise<BrowserWindow> => {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      opacity: 0,
      backgroundColor: windowBackgroundColor,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const painted = whenPainted(window);
    opened.add(window);
    window.on('closed', () => {
      opened.delete(window);
      if (opened.size === 0) {
        options.onLastClosed();
      }
    });
    await load(window);
    await reveal(window, painted);
    return window;
  };

  return {
    open,
    isEmpty: () => opened.size === 0,
  };
};

export const destroyAllWindows = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
};
