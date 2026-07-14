import { type Browser, chromium, type Page } from 'playwright';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
  type BrowserAnalyzeChordsResult,
  releaseChordsApiName,
} from './chordsApi.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
];

const ensureWebGpu = async (page: Page): Promise<void> => {
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
    throw new Error('Headless chords browser could not get a WebGPU adapter');
  }
};

export type ChordsProgressHandler = (progress: number) => void | Promise<void>;

type CreateChordsPageOptions = {
  browser: Browser;
  baseUrl: string;
  onProgress: ChordsProgressHandler;
};

const createChordsPage = async (
  options: CreateChordsPageOptions,
): Promise<Page> => {
  const { browser, baseUrl, onProgress } = options;
  const page = await browser.newPage();
  await page.exposeFunction(
    reportProgressApiName,
    async (message: BrowserProgressMessage) => {
      await onProgress(message.progress);
    },
  );
  await page.goto(`${baseUrl}/chords-service`);
  await ensureWebGpu(page);
  await page.waitForFunction(
    (apiName) => typeof Reflect.get(globalThis, apiName) === 'function',
    analyzeChordsApiName,
  );
  return page;
};

type EvaluateChordsArgs = {
  apiName: string;
  request: BrowserAnalyzeChordsRequest;
};

export const evaluateChordsInPage = async (
  page: Page,
  request: BrowserAnalyzeChordsRequest,
): Promise<BrowserAnalyzeChordsResult> =>
  page.evaluate(
    async (
      evaluateArgs: EvaluateChordsArgs,
    ): Promise<BrowserAnalyzeChordsResult> => {
      const api: unknown = Reflect.get(globalThis, evaluateArgs.apiName);
      if (typeof api !== 'function') {
        throw new Error('Chords browser API is not initialized');
      }
      return await Reflect.apply(api, undefined, [evaluateArgs.request]);
    },
    { apiName: analyzeChordsApiName, request },
  );

export const releaseChordsInPage = async (page: Page): Promise<void> => {
  await page.evaluate(async (apiName: string): Promise<void> => {
    const api: unknown = Reflect.get(globalThis, apiName);
    if (typeof api !== 'function') {
      throw new Error('Chords browser release API is not initialized');
    }
    await Reflect.apply(api, undefined, []);
  }, releaseChordsApiName);
};

export type HeadlessChordsBrowser = {
  page: Page;
  close: () => Promise<void>;
};

type CreateHeadlessChordsBrowserOptions = {
  baseUrl: string;
  onProgress: ChordsProgressHandler;
};

export const createHeadlessChordsBrowser = async (
  options: CreateHeadlessChordsBrowserOptions,
): Promise<HeadlessChordsBrowser> => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });
  try {
    const page = await createChordsPage({
      browser,
      baseUrl: options.baseUrl,
      onProgress: options.onProgress,
    });
    return { page, close: async () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
};
