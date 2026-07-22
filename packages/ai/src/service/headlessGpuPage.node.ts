import { type Logger } from '@musetric/utils';
import { type GpuHost } from './gpuHost.node.js';
import {
  type GpuPage,
  type GpuPageProgressHandler,
} from './gpuPageHost.node.js';
import {
  createGpuModuleServer,
  type GpuModuleRoute,
  type GpuModuleServer,
} from './headlessGpuModuleServer.node.js';

export type RunGpuAnalysisOptions<Request, Result> = {
  gpuHost: GpuHost;
  logger: Logger;
  label: string;
  apiName: string;
  requireShaderF16: boolean;
  pcm: Buffer;
  routes?: GpuModuleRoute[];
  onProgress: GpuPageProgressHandler;
  onConsole?: (text: string) => void;
  onPageError?: (message: string) => void;
  buildRequest: (server: GpuModuleServer) => Request;
  run?: (page: GpuPage, request: Request) => Promise<Result>;
};

export const runGpuAnalysis = async <Request, Result>(
  options: RunGpuAnalysisOptions<Request, Result>,
): Promise<Result> => {
  const { gpuHost, logger, label, apiName, requireShaderF16, pcm, routes } =
    options;
  const { onProgress, onConsole, onPageError, buildRequest, run } = options;
  const moduleServer = await createGpuModuleServer({
    logger,
    label,
    pcm,
    routes,
    browserBundlePath: gpuHost.browserBundlePath,
  });
  try {
    const request = buildRequest(moduleServer);
    const page = await gpuHost.createGpuPage({
      label,
      pageUrl: moduleServer.pageUrl,
      apiName,
      requireShaderF16,
      onProgress,
      onConsole,
      onPageError,
    });
    try {
      return run
        ? await run(page, request)
        : await page.evaluate<Result>(request);
    } finally {
      await page.close();
    }
  } finally {
    await moduleServer.close();
  }
};
