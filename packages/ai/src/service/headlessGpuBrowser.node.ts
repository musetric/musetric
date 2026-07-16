import { type Browser, chromium, type Page } from 'playwright';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
];

const ensureWebGpu = async (page: Page, label: string): Promise<void> => {
  const hasAdapter = await page.evaluate(async () => {
    const gpu: unknown = Reflect.get(navigator, 'gpu');
    if (typeof gpu !== 'object' || !gpu) {
      return false;
    }
    const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
    if (typeof requestAdapter !== 'function') {
      return false;
    }
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);
    return typeof adapter === 'object' && Boolean(adapter);
  });
  if (!hasAdapter) {
    throw new Error(`${label} could not get a WebGPU adapter`);
  }
};

type EvaluateArgs = {
  apiName: string;
  request: unknown;
};

export const evaluateInPage = async <Result>(
  page: Page,
  apiName: string,
  request: unknown,
): Promise<Result> =>
  page.evaluate(
    async (args: EvaluateArgs): Promise<Result> => {
      const api: unknown = Reflect.get(globalThis, args.apiName);
      if (typeof api !== 'function') {
        throw new Error(`Browser API ${args.apiName} is not initialized`);
      }
      return await Reflect.apply(api, undefined, [args.request]);
    },
    { apiName, request },
  );

export const releaseInPage = async (
  page: Page,
  apiName: string,
): Promise<void> => {
  await page.evaluate(async (name: string): Promise<void> => {
    const api: unknown = Reflect.get(globalThis, name);
    if (typeof api !== 'function') {
      throw new Error(`Browser API ${name} is not initialized`);
    }
    await Reflect.apply(api, undefined, []);
  }, apiName);
};

export type GpuProgressHandler = (progress: number) => void | Promise<void>;

export type CreateHeadlessGpuBrowserOptions = {
  label: string;
  pageUrl: string;
  readyApiName: string;
  onProgress: GpuProgressHandler;
};

const createGpuPage = async (
  browser: Browser,
  options: CreateHeadlessGpuBrowserOptions,
): Promise<Page> => {
  const { label, pageUrl, readyApiName, onProgress } = options;
  const page = await browser.newPage();
  await page.exposeFunction(
    reportProgressApiName,
    async (message: BrowserProgressMessage) => {
      await onProgress(message.progress);
    },
  );
  await page.goto(pageUrl);
  await ensureWebGpu(page, label);
  await page.waitForFunction(
    (apiName) => typeof Reflect.get(globalThis, apiName) === 'function',
    readyApiName,
  );
  return page;
};

export type HeadlessGpuBrowser = {
  page: Page;
  close: () => Promise<void>;
};

export const createHeadlessGpuBrowser = async (
  options: CreateHeadlessGpuBrowserOptions,
): Promise<HeadlessGpuBrowser> => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });
  try {
    const page = await createGpuPage(browser, options);
    return { page, close: async () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
};
