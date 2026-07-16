import { type Logger } from '@musetric/utils';
import {
  createHeadlessGpuBrowser,
  evaluateInPage,
  type GpuProgressHandler,
  releaseInPage,
} from './headlessGpuBrowser.node.js';
import { createGpuModuleServer } from './headlessGpuModuleServer.node.js';

type HeadlessGpuServiceState = {
  activeProgress: GpuProgressHandler | undefined;
  analysisTail: Promise<void>;
  isClosing: boolean;
  closePromise: Promise<void> | undefined;
};

const isServiceClosing = (state: HeadlessGpuServiceState): boolean =>
  state.isClosing;

export type GpuRequestUrls = {
  pcmUrl: string;
  registerFile: (path: string) => string;
};

export type HeadlessGpuRunOptions<Request> = {
  pcm: Buffer;
  buildRequest: (urls: GpuRequestUrls) => Request;
  onProgress: GpuProgressHandler;
};

export type HeadlessGpuService<Request, Result> = {
  run: (options: HeadlessGpuRunOptions<Request>) => Promise<Result>;
  close: () => Promise<void>;
};

export type CreateHeadlessGpuServiceOptions = {
  logger: Logger;
  label: string;
  pageRoute: string;
  entryModule: string;
  analyzeApiName: string;
  releaseApiName: string;
};

export const createHeadlessGpuService = async <Request, Result>(
  options: CreateHeadlessGpuServiceOptions,
): Promise<HeadlessGpuService<Request, Result>> => {
  const { logger, label, pageRoute, entryModule } = options;
  const { analyzeApiName, releaseApiName } = options;
  const moduleServer = await createGpuModuleServer({
    logger,
    label,
    pageRoute,
    entryModule,
  });
  try {
    const state: HeadlessGpuServiceState = {
      activeProgress: undefined,
      analysisTail: Promise.resolve(),
      isClosing: false,
      closePromise: undefined,
    };
    const browser = await createHeadlessGpuBrowser({
      label,
      pageUrl: moduleServer.pageUrl,
      readyApiName: analyzeApiName,
      onProgress: async (progress) => {
        if (state.activeProgress !== undefined) {
          await state.activeProgress(progress);
        }
      },
    });
    const run = async (
      runOptions: HeadlessGpuRunOptions<Request>,
    ): Promise<Result> => {
      if (isServiceClosing(state)) {
        throw new Error(`${label} is closing`);
      }
      const previousAnalysis = state.analysisTail;
      let finishAnalysis: () => void = (): undefined => undefined;
      state.analysisTail = new Promise<void>((resolve) => {
        finishAnalysis = resolve;
      });
      await previousAnalysis;
      try {
        if (state.isClosing) {
          throw new Error(`${label} is closing`);
        }
        const { pcm, buildRequest, onProgress } = runOptions;
        state.activeProgress = onProgress;
        moduleServer.setPcm(pcm);
        const request = buildRequest({
          pcmUrl: moduleServer.pcmUrl,
          registerFile: moduleServer.registerFile,
        });
        return await evaluateInPage<Result>(
          browser.page,
          analyzeApiName,
          request,
        );
      } finally {
        state.activeProgress = undefined;
        finishAnalysis();
      }
    };
    const close = async (): Promise<void> => {
      if (state.closePromise !== undefined) {
        await state.closePromise;
        return;
      }
      state.isClosing = true;
      const closeService = async (): Promise<void> => {
        await state.analysisTail;
        try {
          await releaseInPage(browser.page, releaseApiName);
        } finally {
          try {
            await browser.close();
          } finally {
            await moduleServer.close();
          }
        }
      };
      state.closePromise = closeService();
      await state.closePromise;
    };
    return { run, close };
  } catch (error) {
    await moduleServer.close();
    throw error;
  }
};
