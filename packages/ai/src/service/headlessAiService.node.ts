import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Logger } from '@musetric/utils';
import { type Browser, chromium, type Download, type Page } from 'playwright';
import * as vite from 'vite';
import { type SeparateAudioMessage } from '../separation/separateAudio.node.js';
import {
  type BrowserSeparateAudioRequest,
  reportProgressApiName,
  separateAudioApiName,
  stemDownloadNames,
  type StemKey,
} from './browserApi.js';
import { type SeparationModelFiles } from './modelCache.node.js';

type ProgressMessageHandler = (
  message: Extract<SeparateAudioMessage, { type: 'progress' }>,
) => void | Promise<void>;

type HeadlessSeparateAudioOptions = {
  logger: Logger;
  pcm: Buffer;
  sampleRate: number;
  modelFiles: SeparationModelFiles;
  rawStemPaths: Record<StemKey, string>;
  onMessage: ProgressMessageHandler;
};

type ModuleServer = {
  baseUrl: string;
  registerModelFile: (path: string) => string;
  pcmUrl: string;
  close: () => Promise<void>;
};

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
];

const getPackageRoot = (): string =>
  dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const getFileToken = (path: string): string =>
  createHash('sha256').update(path).digest('hex').slice(0, 20);

const sendFile = async (
  path: string,
  response: ServerResponse,
): Promise<void> => {
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  });
};

const handleModuleRequest = async (options: {
  request: IncomingMessage;
  response: ServerResponse;
  viteServer: vite.ViteDevServer;
  modelFiles: Map<string, string>;
  pcm: Buffer;
  logger: Logger;
}): Promise<void> => {
  const { request, response, viteServer, modelFiles, pcm, logger } = options;
  const requestUrl = request.url ?? '/';
  const url = new URL(requestUrl, 'http://127.0.0.1');

  if (url.pathname === '/ai-service') {
    const html = await viteServer.transformIndexHtml(
      url.pathname,
      '<!doctype html><script type="module" src="/src/service/browserEntry.ts"></script>',
    );
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }

  if (url.pathname === '/pcm') {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(pcm);
    return;
  }

  if (url.pathname.startsWith('/models/')) {
    const parts = url.pathname.split('/');
    const [, , token] = parts;
    const modelPath = token ? modelFiles.get(token) : undefined;
    if (!modelPath) {
      response.writeHead(404);
      response.end('model not found');
      return;
    }
    await sendFile(modelPath, response);
    return;
  }

  viteServer.middlewares(request, response, () => {
    logger.warn({ url: requestUrl }, 'AI service route not found');
    response.writeHead(404);
    response.end('not found');
  });
};

const createModuleServer = async (
  logger: Logger,
  pcm: Buffer,
): Promise<ModuleServer> => {
  const packageRoot = getPackageRoot();
  const packagesRoot = dirname(packageRoot);
  const repositoryRoot = dirname(packagesRoot);
  const browserEntry = join(packageRoot, 'src/service/browserEntry.ts');
  if (!existsSync(browserEntry)) {
    throw new Error(`AI browser entry not found at ${browserEntry}`);
  }

  const modelFiles = new Map<string, string>();
  const viteServer = await vite.createServer({
    root: packageRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {
      middlewareMode: true,
      watch: { ignored: ['**'] },
      fs: {
        allow: [repositoryRoot],
      },
    },
    resolve: {
      alias: [
        {
          find: '@musetric/fft/gpu',
          replacement: join(packagesRoot, 'fft/src/index.ts'),
        },
        {
          find: '@musetric/utils/gpu',
          replacement: join(packagesRoot, 'utils/src/index.gpu.ts'),
        },
        {
          find: '@musetric/utils',
          replacement: join(packagesRoot, 'utils/src/index.ts'),
        },
      ],
    },
    optimizeDeps: {
      include: ['onnxruntime-web/webgpu'],
    },
  });

  const server = createServer((request, response) => {
    void handleModuleRequest({
      request,
      response,
      viteServer,
      modelFiles,
      pcm,
      logger,
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('AI service failed to bind a local HTTP port');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    registerModelFile: (path) => {
      const token = getFileToken(path);
      modelFiles.set(token, path);
      return `${baseUrl}/models/${token}/${basename(path)}`;
    },
    pcmUrl: `${baseUrl}/pcm`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await viteServer.close();
    },
  };
};

const launchBrowser = async (): Promise<Browser> =>
  chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });

const ensureWebGpu = async (page: Page): Promise<void> => {
  const support = await page.evaluate(async () => {
    const failure = { adapter: false, shaderF16: false };
    const gpu: unknown = Reflect.get(navigator, 'gpu');
    if (typeof gpu !== 'object' || !gpu) {
      return failure;
    }
    const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
    if (typeof requestAdapter !== 'function') {
      return failure;
    }
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);
    if (typeof adapter !== 'object' || !adapter) {
      return failure;
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
    throw new Error('Headless AI browser could not get a WebGPU adapter');
  }
  if (!support.shaderF16) {
    throw new Error(
      'WebGPU adapter does not support shader-f16 required by the vocals separation model',
    );
  }
};

const createPage = async (
  browser: Browser,
  baseUrl: string,
  onMessage: ProgressMessageHandler,
): Promise<Page> => {
  const page = await browser.newPage();
  await page.exposeFunction(
    reportProgressApiName,
    async (message: Extract<SeparateAudioMessage, { type: 'progress' }>) => {
      await onMessage(message);
    },
  );
  await page.goto(`${baseUrl}/ai-service`);
  await ensureWebGpu(page);
  await page.waitForFunction(
    (apiName) => typeof Reflect.get(globalThis, apiName) === 'function',
    separateAudioApiName,
  );
  return page;
};

const registerStemDownloads = async (
  page: Page,
  rawStemPaths: Record<StemKey, string>,
): Promise<void> => {
  const targets = new Map<string, string>([
    [stemDownloadNames.lead, rawStemPaths.lead],
    [stemDownloadNames.backing, rawStemPaths.backing],
    [stemDownloadNames.instrumental, rawStemPaths.instrumental],
  ]);
  const remaining = new Set(targets.keys());

  return new Promise<void>((resolve, reject) => {
    const onDownload = (download: Download): void => {
      const name = download.suggestedFilename();
      const target = targets.get(name);
      if (!target) {
        reject(new Error(`Unexpected AI download: ${name}`));
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

export const separateAudioHeadless = async (
  options: HeadlessSeparateAudioOptions,
): Promise<void> => {
  const { logger, pcm, sampleRate, modelFiles, rawStemPaths, onMessage } =
    options;
  const moduleServer = await createModuleServer(logger, pcm);
  try {
    const browser = await launchBrowser();
    try {
      const page = await createPage(browser, moduleServer.baseUrl, onMessage);

      const downloadsSaved = registerStemDownloads(page, rawStemPaths);

      const request: BrowserSeparateAudioRequest = {
        pcmUrl: moduleServer.pcmUrl,
        sampleRate,
        vocalsModelUrl: moduleServer.registerModelFile(
          modelFiles.vocalsModelPath,
        ),
        vocalsModelDataUrl: moduleServer.registerModelFile(
          modelFiles.vocalsModelDataPath,
        ),
        vocalsModelDataPath: basename(modelFiles.vocalsModelDataPath),
        leadBackingModelUrl: moduleServer.registerModelFile(
          modelFiles.leadBackingModelPath,
        ),
      };

      await page.evaluate(
        (evaluateArgs: {
          apiName: string;
          request: BrowserSeparateAudioRequest;
        }) => {
          const api: unknown = Reflect.get(globalThis, evaluateArgs.apiName);
          if (typeof api !== 'function') {
            throw new Error('AI browser API is not initialized');
          }
          return Reflect.apply(api, undefined, [evaluateArgs.request]);
        },
        { apiName: separateAudioApiName, request },
      );

      await downloadsSaved;
    } finally {
      await browser.close();
    }
  } finally {
    await moduleServer.close();
  }
};
