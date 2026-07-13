import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { type Logger } from '@musetric/utils';
import { type Browser, chromium, type Page } from 'playwright';
import * as vite from 'vite';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
  transcribeAudioApiName,
} from './transcribeApi.js';
import { whisperCacheDirName } from './whisperModelCache.node.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
];

const getPackageRoot = (): string =>
  dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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

type ServeHfFileOptions = {
  relPath: string;
  search: string;
  cacheDir: string;
  response: ServerResponse;
  logger: Logger;
};

const serveHfFile = async (options: ServeHfFileOptions): Promise<void> => {
  const { relPath, search, cacheDir, response, logger } = options;
  const safe = relPath.replace(/\.\.+/g, '').replace(/[^a-zA-Z0-9._/-]/g, '_');
  const filePath = join(cacheDir, safe);
  if (existsSync(filePath)) {
    await sendFile(filePath, response);
    return;
  }

  const upstream = `https://huggingface.co/${relPath}${search}`;
  const upstreamResponse = await fetch(upstream);
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    logger.warn(
      { upstream, status: upstreamResponse.status },
      'HF fetch failed',
    );
    response.writeHead(upstreamResponse.status || 502);
    response.end('hf fetch failed');
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await pipeline(
    Readable.fromWeb(upstreamResponse.body),
    createWriteStream(tempPath),
  );
  await rename(tempPath, filePath);
  await sendFile(filePath, response);
};

type ModuleServer = {
  baseUrl: string;
  pcmUrl: string;
  close: () => Promise<void>;
};

const createModuleServer = async (
  logger: Logger,
  pcm: Buffer,
  cacheDir: string,
): Promise<ModuleServer> => {
  const packageRoot = getPackageRoot();
  const packagesRoot = dirname(packageRoot);
  const repositoryRoot = dirname(packagesRoot);

  const viteServer = await vite.createServer({
    root: packageRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {
      middlewareMode: true,
      watch: { ignored: ['**'] },
      fs: { allow: [repositoryRoot] },
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
      include: ['@huggingface/transformers'],
    },
  });

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const requestUrl = request.url ?? '/';
    const url = new URL(requestUrl, 'http://127.0.0.1');

    if (url.pathname === '/transcribe-service') {
      const html = await viteServer.transformIndexHtml(
        url.pathname,
        '<!doctype html><script type="module" src="/src/service/browserTranscribeEntry.ts"></script>',
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

    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname.startsWith('/hf/')) {
      await serveHfFile({
        relPath: url.pathname.slice('/hf/'.length),
        search: url.search,
        cacheDir,
        response,
        logger,
      });
      return;
    }

    viteServer.middlewares(request, response, () => {
      logger.warn({ url: requestUrl }, 'Transcription service route not found');
      response.writeHead(404);
      response.end('not found');
    });
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      logger.error({ error }, 'Transcription service request failed');
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end('error');
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Transcription service failed to bind a local HTTP port');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
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
    throw new Error(
      'Headless transcription browser could not get a WebGPU adapter',
    );
  }
  if (!support.shaderF16) {
    throw new Error(
      'WebGPU adapter does not support shader-f16 required by the Whisper model',
    );
  }
};

const createPage = async (
  browser: Browser,
  baseUrl: string,
  onProgress: (progress: number) => void | Promise<void>,
  logger: Logger,
): Promise<Page> => {
  const page = await browser.newPage();
  page.on('console', (message) => {
    logger.info({ browser: true }, `[browser] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    logger.error({ browser: true }, `[browser] ${error.message}`);
  });
  await page.exposeFunction(
    reportProgressApiName,
    async (message: BrowserProgressMessage) => {
      await onProgress(message.progress);
    },
  );
  await page.goto(`${baseUrl}/transcribe-service`);
  await ensureWebGpu(page);
  await page.waitForFunction(
    (apiName) => typeof Reflect.get(globalThis, apiName) === 'function',
    transcribeAudioApiName,
  );
  return page;
};

export type HeadlessTranscribeOptions = {
  logger: Logger;

  pcm: Buffer;
  sampleRate: number;
  modelId: string;
  revision: string;
  language?: string;

  modelsPath: string;
  onProgress: (progress: number) => void | Promise<void>;
};

type TranscribeEvaluateArgs = {
  apiName: string;
  request: BrowserTranscribeRequest;
};

export const transcribeAudioHeadless = async (
  options: HeadlessTranscribeOptions,
): Promise<BrowserTranscribeResult> => {
  const { logger, pcm, sampleRate, modelId, revision, language } = options;
  const cacheDir = join(options.modelsPath, whisperCacheDirName);
  const moduleServer = await createModuleServer(logger, pcm, cacheDir);
  try {
    const browser = await launchBrowser();
    try {
      const page = await createPage(
        browser,
        moduleServer.baseUrl,
        options.onProgress,
        logger,
      );
      const request: BrowserTranscribeRequest = {
        pcmUrl: moduleServer.pcmUrl,
        sampleRate,
        modelHost: `${moduleServer.baseUrl}/hf`,
        modelId,
        revision,
        language,
      };
      return await page.evaluate(
        async (
          evaluateArgs: TranscribeEvaluateArgs,
        ): Promise<BrowserTranscribeResult> => {
          const api: unknown = Reflect.get(globalThis, evaluateArgs.apiName);
          if (typeof api !== 'function') {
            throw new Error('Transcription browser API is not initialized');
          }

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          return (await Reflect.apply(api, undefined, [
            evaluateArgs.request,
          ])) as BrowserTranscribeResult;
        },
        { apiName: transcribeAudioApiName, request },
      );
    } finally {
      await browser.close();
    }
  } finally {
    await moduleServer.close();
  }
};
