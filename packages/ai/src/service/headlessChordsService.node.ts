import { type Logger } from '@musetric/utils';
import { type BrowserAnalyzeChordsRequest } from './chordsApi.js';
import {
  type ChordsProgressHandler,
  createHeadlessChordsBrowser,
  evaluateChordsInPage,
  releaseChordsInPage,
} from './headlessChordsBrowser.node.js';
import { createChordsModuleServer } from './headlessChordsModuleServer.node.js';

type HeadlessChordsServiceState = {
  activeProgress: ChordsProgressHandler | undefined;
  analysisTail: Promise<void>;
  isClosing: boolean;
  closePromise: Promise<void> | undefined;
};

const isChordsServiceClosing = (state: HeadlessChordsServiceState): boolean =>
  state.isClosing;

export type HeadlessChordAnalysisOptions = {
  pcm: Buffer;
  modelPath: string;
  planPath: string;
  planManifestPath?: string;
  onProgress: ChordsProgressHandler;
};

export type HeadlessChordsService = {
  analyze: (options: HeadlessChordAnalysisOptions) => Promise<Int32Array>;
  close: () => Promise<void>;
};

export type CreateHeadlessChordsServiceOptions = {
  logger: Logger;
};

export const createHeadlessChordsService = async (
  options: CreateHeadlessChordsServiceOptions,
): Promise<HeadlessChordsService> => {
  const moduleServer = await createChordsModuleServer({
    logger: options.logger,
  });
  try {
    const state: HeadlessChordsServiceState = {
      activeProgress: undefined,
      analysisTail: Promise.resolve(),
      isClosing: false,
      closePromise: undefined,
    };
    const browser = await createHeadlessChordsBrowser({
      baseUrl: moduleServer.baseUrl,
      onProgress: async (progress) => {
        if (state.activeProgress !== undefined) {
          await state.activeProgress(progress);
        }
      },
    });
    const analyze = async (
      analysisOptions: HeadlessChordAnalysisOptions,
    ): Promise<Int32Array> => {
      if (isChordsServiceClosing(state)) {
        throw new Error('Headless chords service is closing');
      }
      const previousAnalysis = state.analysisTail;
      let finishAnalysis: () => void = (): undefined => undefined;
      state.analysisTail = new Promise<void>((resolve) => {
        finishAnalysis = resolve;
      });
      await previousAnalysis;
      try {
        if (isChordsServiceClosing(state)) {
          throw new Error('Headless chords service is closing');
        }
        const { pcm, modelPath, planPath, planManifestPath, onProgress } =
          analysisOptions;
        state.activeProgress = onProgress;
        moduleServer.setPcm(pcm);
        const request: BrowserAnalyzeChordsRequest = {
          pcmUrl: moduleServer.pcmUrl,
          modelUrl: moduleServer.registerModelFile(modelPath),
          planUrl: moduleServer.registerPlanFile(planPath),
          planManifestUrl:
            planManifestPath === undefined
              ? undefined
              : moduleServer.registerPlanManifestFile(planManifestPath),
        };
        return Int32Array.from(
          await evaluateChordsInPage(browser.page, request),
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
          await releaseChordsInPage(browser.page);
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
    return { analyze, close };
  } catch (error) {
    await moduleServer.close();
    throw error;
  }
};
