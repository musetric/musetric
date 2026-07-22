import { fileURLToPath } from 'node:url';
import {
  type CreateGpuPageOptions,
  type GpuPage,
  type GpuPageHostFactory,
} from '@musetric/ai/node';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { gpuPageErrorChannel, gpuProgressChannel } from './electronGpuIpc.js';

const preloadPath = fileURLToPath(
  new URL('./electronGpuPreload.cjs', import.meta.url),
);

const getWebContentsId = (event: IpcMainInvokeEvent): number => event.sender.id;

const getProgress = (message: unknown): number | undefined => {
  if (typeof message !== 'object' || !message) {
    return undefined;
  }
  const progress: unknown = Reflect.get(message, 'progress');
  return typeof progress === 'number' ? progress : undefined;
};

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type GpuSupport = {
  apiReady: boolean;
  adapter: boolean;
  shaderF16: boolean;
};

const waitForReady = async (
  window: BrowserWindow,
  options: CreateGpuPageOptions,
): Promise<void> => {
  const { label, apiName, requireShaderF16 } = options;
  const deadline = Date.now() + 30_000;
  const script = `
    (async () => {
      const apiReady = typeof Reflect.get(globalThis, ${JSON.stringify(apiName)}) === 'function';
      const gpu = Reflect.get(navigator, 'gpu');
      if (typeof gpu !== 'object' || !gpu) {
        return { apiReady, adapter: false, shaderF16: false };
      }
      const requestAdapter = Reflect.get(gpu, 'requestAdapter');
      if (typeof requestAdapter !== 'function') {
        return { apiReady, adapter: false, shaderF16: false };
      }
      const adapter = await Reflect.apply(requestAdapter, gpu, []);
      if (typeof adapter !== 'object' || !adapter) {
        return { apiReady, adapter: false, shaderF16: false };
      }
      const features = Reflect.get(adapter, 'features');
      const has = typeof features === 'object' && features ? Reflect.get(features, 'has') : undefined;
      return {
        apiReady,
        adapter: true,
        shaderF16: typeof has === 'function' && Boolean(Reflect.apply(has, features, ['shader-f16'])),
      };
    })();
  `;
  const readSupport = async (): Promise<GpuSupport> =>
    window.webContents.executeJavaScript(script);
  let support: GpuSupport = {
    apiReady: false,
    adapter: false,
    shaderF16: false,
  };
  while (Date.now() < deadline) {
    support = await readSupport();
    if (support.adapter && support.apiReady) {
      if (requireShaderF16 && !support.shaderF16) {
        throw new Error(
          `${label} adapter does not support required shader-f16`,
        );
      }
      return;
    }
    await delay(100);
  }
  if (!support.adapter) {
    throw new Error(
      `${label} could not get a WebGPU adapter: this machine has no GPU Musetric can run on`,
    );
  }
  throw new Error(
    `${label} did not expose its browser API ${apiName} within 30 seconds`,
  );
};

const evaluateApi = async <Result>(
  window: BrowserWindow,
  apiName: string,
  request: unknown,
): Promise<Result> => {
  const args = JSON.stringify({ apiName, request });
  return window.webContents.executeJavaScript(`
    (async () => {
      const args = ${args};
      const api = Reflect.get(globalThis, args.apiName);
      if (typeof api !== 'function') {
        throw new Error(\`Browser API \${args.apiName} is not initialized\`);
      }
      return Reflect.apply(api, undefined, [args.request]);
    })();
  `);
};

const captureDownloads = async (
  window: BrowserWindow,
  targets: Map<string, string>,
): Promise<void> => {
  const remaining = new Set(targets.keys());
  const { session } = window.webContents;
  return new Promise<void>((resolve, reject) => {
    const onDownload = (
      _event: Electron.Event,
      item: Electron.DownloadItem,
    ): void => {
      const name = item.getFilename();
      const target = targets.get(name);
      const stopListening = (): void => {
        session.off('will-download', onDownload);
      };
      if (target === undefined) {
        item.cancel();
        stopListening();
        reject(new Error(`Unexpected browser download: ${name}`));
        return;
      }
      item.setSavePath(target);
      item.once('done', (_doneEvent, state) => {
        if (state !== 'completed') {
          stopListening();
          reject(new Error(`Browser download did not complete: ${state}`));
          return;
        }
        remaining.delete(name);
        if (remaining.size === 0) {
          stopListening();
          resolve();
        }
      });
    };
    session.on('will-download', onDownload);
  });
};

export const createElectronGpuHost = (): GpuPageHostFactory => {
  const progressHandlers = new Map<
    number,
    NonNullable<CreateGpuPageOptions['onProgress']>
  >();
  const pageErrorHandlers = new Map<
    number,
    NonNullable<CreateGpuPageOptions['onPageError']>
  >();
  let nextGpuPageId = 0;

  ipcMain.handle(gpuProgressChannel, async (event, message: unknown) => {
    const handler = progressHandlers.get(getWebContentsId(event));
    const progress = getProgress(message);
    if (handler !== undefined && progress !== undefined) {
      await handler(progress);
    }
  });

  ipcMain.on(gpuPageErrorChannel, (event, message: unknown) => {
    const handler = pageErrorHandlers.get(event.sender.id);
    if (handler !== undefined) {
      handler(String(message));
    }
  });

  const closeGpuPage = async (window: BrowserWindow): Promise<void> => {
    progressHandlers.delete(window.webContents.id);
    pageErrorHandlers.delete(window.webContents.id);
    if (!window.isDestroyed()) {
      const closed = new Promise<void>((resolve) => {
        window.once('closed', resolve);
      });
      window.destroy();
      await closed;
    }
  };

  return async (options: CreateGpuPageOptions): Promise<GpuPage> => {
    const { apiName, onConsole, onPageError, onProgress, pageUrl } = options;
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: `musetric-ai-${nextGpuPageId++}`,
        preload: preloadPath,
      },
    });
    const webContentsId = window.webContents.id;
    if (onProgress !== undefined) {
      progressHandlers.set(webContentsId, onProgress);
    }
    if (onPageError !== undefined) {
      pageErrorHandlers.set(webContentsId, onPageError);
    }
    if (onConsole !== undefined) {
      window.webContents.on('console-message', (details) => {
        onConsole(details.message);
      });
    }
    try {
      await window.loadURL(pageUrl);
      await waitForReady(window, options);
      return {
        evaluate: async <Result>(request: unknown) =>
          evaluateApi<Result>(window, apiName, request),
        captureDownloads: async (targets) => captureDownloads(window, targets),
        close: async () => closeGpuPage(window),
      };
    } catch (error) {
      await closeGpuPage(window);
      throw error;
    }
  };
};
