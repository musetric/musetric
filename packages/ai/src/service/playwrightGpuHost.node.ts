import { type Browser, chromium, type Download, type Page } from 'playwright';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import { type CreateGpuPageOptions, type GpuPage } from './gpuPageHost.node.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
];

const ensureWebGpu = async (
  page: Page,
  label: string,
  requireShaderF16: boolean,
): Promise<void> => {
  const support = await page.evaluate(async () => {
    const gpu: unknown = Reflect.get(navigator, 'gpu');
    if (typeof gpu !== 'object' || !gpu) {
      return { adapter: false, shaderF16: false };
    }
    const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
    if (typeof requestAdapter !== 'function') {
      return { adapter: false, shaderF16: false };
    }
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);
    if (typeof adapter !== 'object' || !adapter) {
      return { adapter: false, shaderF16: false };
    }
    const features: unknown = Reflect.get(adapter, 'features');
    const has =
      typeof features === 'object' && features
        ? Reflect.get(features, 'has')
        : undefined;
    const shaderF16 =
      typeof has === 'function'
        ? Boolean(Reflect.apply(has, features, ['shader-f16']))
        : false;
    return { adapter: true, shaderF16 };
  });
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

const createGpuPage = async (
  browser: Browser,
  options: CreateGpuPageOptions,
): Promise<Page> => {
  const { label, pageUrl, apiName, requireShaderF16 } = options;
  const { onProgress, onConsole, onPageError } = options;
  const page = await browser.newPage();
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
  if (onProgress !== undefined) {
    await page.exposeFunction(
      reportProgressApiName,
      async (message: BrowserProgressMessage) => {
        await onProgress(message.progress);
      },
    );
  }
  await page.goto(pageUrl);
  await ensureWebGpu(page, label, requireShaderF16);
  await page.waitForFunction(
    (name) => typeof Reflect.get(globalThis, name) === 'function',
    apiName,
  );
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
