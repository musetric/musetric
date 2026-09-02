import { type Browser, chromium, type Download, type Page } from 'playwright';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import { gpuSupportApiName } from './browserGpuSupport.js';
import { type CreateGpuPageOptions, type GpuPage } from './gpuPageHost.node.js';
import { createJobGpuPage, type OpenedPage } from './jobGpuPage.node.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
  '--force_high_performance_gpu',
];

const ensureWebGpu = async (
  page: Page,
  label: string,
  requireShaderF16: boolean,
): Promise<void> => {
  const support = await page.evaluate(async (name: string) => {
    const api: unknown = Reflect.get(globalThis, name);
    if (typeof api !== 'function') {
      return { adapter: false, shaderF16: false };
    }
    const reported: unknown = await Reflect.apply(api, undefined, []);
    const read = (key: string): boolean =>
      typeof reported === 'object' && reported
        ? Boolean(Reflect.get(reported, key))
        : false;
    return { adapter: read('adapter'), shaderF16: read('shaderF16') };
  }, gpuSupportApiName);
  if (!support.adapter) {
    throw new Error(`${label} could not get a WebGPU adapter`);
  }
  if (requireShaderF16 && !support.shaderF16) {
    throw new Error(`${label} adapter does not support required shader-f16`);
  }
};

type EvaluateApiArgs = {
  apiName: string;
  request: unknown;
};

const evaluateApi = async <Result>(
  page: Page,
  apiName: string,
  request: unknown,
): Promise<Result> =>
  page.evaluate(
    async (args: EvaluateApiArgs): Promise<Result> => {
      const api: unknown = Reflect.get(globalThis, args.apiName);
      if (typeof api !== 'function') {
        throw new Error(`Browser API ${args.apiName} is not initialized`);
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return (await Reflect.apply(api, undefined, [args.request])) as Result;
    },
    { apiName, request },
  );

const captureDownloads = async (
  page: Page,
  targets: Map<string, string>,
): Promise<void> => {
  const remaining = new Set(targets.keys());
  return new Promise<void>((resolve, reject) => {
    const onDownload = (download: Download): void => {
      const name = download.suggestedFilename();
      const target = targets.get(name);
      if (target === undefined) {
        reject(new Error(`Unexpected browser download: ${name}`));
        return;
      }
      void download
        .saveAs(target)
        .then(() => {
          remaining.delete(name);
          if (remaining.size === 0) {
            page.off('download', onDownload);
            resolve();
          }
        })
        .catch(reject);
    };
    page.on('download', onDownload);
  });
};

const attachDiagnostics = (page: Page, options: CreateGpuPageOptions): void => {
  const { onConsole, onPageError } = options;
  if (onConsole !== undefined) {
    page.on('console', (message) => {
      onConsole(message.text());
    });
  }
  if (onPageError !== undefined) {
    page.on('pageerror', (error) => {
      onPageError(error.message);
    });
  }
};

const createGpuPage = async (
  browser: Browser,
  options: CreateGpuPageOptions,
): Promise<Page> => {
  const { label, pageUrl, apiName, requireShaderF16, onProgress } = options;
  const page = await browser.newPage();
  attachDiagnostics(page, options);
  if (onProgress !== undefined) {
    await page.exposeFunction(
      reportProgressApiName,
      async (message: BrowserProgressMessage) => {
        await onProgress(message.progress);
      },
    );
  }
  await page.goto(pageUrl);
  await page.waitForFunction(
    (name) => typeof Reflect.get(globalThis, name) === 'function',
    apiName,
  );
  await ensureWebGpu(page, label, requireShaderF16);
  return page;
};

export const createPlaywrightGpuPage = async (
  options: CreateGpuPageOptions,
): Promise<GpuPage> => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });
  try {
    const page = await createGpuPage(browser, options);
    return {
      evaluate: async <Result>(request: unknown) =>
        evaluateApi<Result>(page, options.apiName, request),
      captureDownloads: async (targets) => captureDownloads(page, targets),
      close: async () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
};

export const createPlaywrightJobGpuPage = async (
  options: CreateGpuPageOptions,
): Promise<GpuPage> => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });
  const open = async (url: string): Promise<OpenedPage> => {
    const page = await browser.newPage();
    attachDiagnostics(page, options);
    await page.goto(url);
    return { close: async () => browser.close() };
  };
  try {
    return await createJobGpuPage({ ...options, open });
  } catch (error) {
    await browser.close();
    throw error;
  }
};
