import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Logger } from '@musetric/resource-utils';
import { type Browser, chromium, type Page } from 'playwright';
import * as vite from 'vite';
import { type SeparateAudioMessage } from '../separation/separateAudio.node.js';
import { type StereoAudio } from '../separation/stereoAudio.js';
import {
  type BrowserSeparateAudioRequest,
  type BrowserSeparateAudioResponse,
  reportProgressApiName,
  separateAudioApiName,
} from './browserApi.js';
import { type SeparationModelFiles } from './modelCache.node.js';

type ProgressMessageHandler = (
  message: Extract<SeparateAudioMessage, { type: 'progress' }>,
) => void | Promise<void>;

type HeadlessSeparateAudioOptions = {
  logger: Logger;
  audio: StereoAudio;
  modelFiles: SeparationModelFiles;
  onMessage: ProgressMessageHandler;
};

type HeadlessSeparateAudioResult = {
  lead: StereoAudio;
  backing: StereoAudio;
  instrumental: StereoAudio;
};

type ModuleServer = {
  baseUrl: string;
  registerModelFile: (path: string) => string;
  registerBinary: (data: Uint8Array<ArrayBuffer>) => string;
  consumeBinary: (token: string) => Uint8Array<ArrayBuffer>;
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

const createToken = (): string => randomUUID().replaceAll('-', '');

const toArrayBufferBytes = (
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> => {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Uint8Array(buffer);
};

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

const sendBinary = (
  data: Uint8Array<ArrayBuffer>,
  response: ServerResponse,
): void => {
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(data);
};

const readRequestBody = async (
  request: IncomingMessage,
): Promise<Uint8Array<ArrayBuffer>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return toArrayBufferBytes(Buffer.concat(chunks));
};

const handleModuleRequest = async (options: {
  request: IncomingMessage;
  response: ServerResponse;
  viteServer: vite.ViteDevServer;
  modelFiles: Map<string, string>;
  binaryBuffers: Map<string, Uint8Array<ArrayBuffer>>;
  logger: Logger;
}): Promise<void> => {
  const { request, response, viteServer, modelFiles, binaryBuffers, logger } =
    options;
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

  if (request.method === 'GET' && url.pathname.startsWith('/buffers/')) {
    const parts = url.pathname.split('/');
    const [, , token] = parts;
    const data = token ? binaryBuffers.get(token) : undefined;
    if (!data) {
      response.writeHead(404);
      response.end('buffer not found');
      return;
    }
    binaryBuffers.delete(token);
    sendBinary(data, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/buffers') {
    const token = createToken();
    binaryBuffers.set(token, await readRequestBody(request));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ token }));
    return;
  }

  viteServer.middlewares(request, response, () => {
    logger.warn({ url: requestUrl }, 'AI service route not found');
    response.writeHead(404);
    response.end('not found');
  });
};

const createModuleServer = async (logger: Logger): Promise<ModuleServer> => {
  const packageRoot = getPackageRoot();
  const packagesRoot = dirname(packageRoot);
  const repositoryRoot = dirname(packagesRoot);
  const browserEntry = join(packageRoot, 'src/service/browserEntry.ts');
  if (!existsSync(browserEntry)) {
    throw new Error(`AI browser entry not found at ${browserEntry}`);
  }

  const modelFiles = new Map<string, string>();
  const binaryBuffers = new Map<string, Uint8Array<ArrayBuffer>>();
  const viteServer = await vite.createServer({
    root: packageRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {
      middlewareMode: true,
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
          find: '@musetric/resource-utils/gpu',
          replacement: join(packagesRoot, 'resource-utils/src/index.gpu.ts'),
        },
        {
          find: '@musetric/resource-utils',
          replacement: join(packagesRoot, 'resource-utils/src/index.ts'),
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
      binaryBuffers,
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
    registerBinary: (data) => {
      const token = createToken();
      binaryBuffers.set(token, data);
      return `${baseUrl}/buffers/${token}`;
    },
    consumeBinary: (token) => {
      const data = binaryBuffers.get(token);
      if (!data) {
        throw new Error(`AI service buffer ${token} not found`);
      }
      binaryBuffers.delete(token);
      return data;
    },
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
    // The default headless shell ships without dxcompiler.dll/dxil.dll, so
    // requestDevice with shader-f16 fails on Windows; the full build has them.
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

const createStereoAudio = (
  source: StereoAudio,
  data: Uint8Array<ArrayBuffer>,
): StereoAudio => ({
  sampleRate: source.sampleRate,
  samples: source.samples,
  channels: 2,
  data: new Float32Array(data.buffer),
});

export const separateAudioHeadless = async (
  options: HeadlessSeparateAudioOptions,
): Promise<HeadlessSeparateAudioResult> => {
  const { logger, audio, modelFiles, onMessage } = options;
  const moduleServer = await createModuleServer(logger);
  try {
    const browser = await launchBrowser();
    try {
      const page = await createPage(browser, moduleServer.baseUrl, onMessage);
      const audioBytes = new Uint8Array(
        audio.data.buffer,
        audio.data.byteOffset,
        audio.data.byteLength,
      );
      const request: BrowserSeparateAudioRequest = {
        sampleRate: audio.sampleRate,
        samples: audio.samples,
        audioUrl: moduleServer.registerBinary(toArrayBufferBytes(audioBytes)),
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
      const response = await page.evaluate(
        (evaluateArgs: {
          apiName: string;
          request: BrowserSeparateAudioRequest;
        }):
          | BrowserSeparateAudioResponse
          | Promise<BrowserSeparateAudioResponse> => {
          const api: unknown = Reflect.get(globalThis, evaluateArgs.apiName);
          if (typeof api !== 'function') {
            throw new Error('AI browser API is not initialized');
          }
          return Reflect.apply(api, undefined, [evaluateArgs.request]);
        },
        { apiName: separateAudioApiName, request },
      );

      return {
        lead: createStereoAudio(
          audio,
          moduleServer.consumeBinary(response.leadToken),
        ),
        backing: createStereoAudio(
          audio,
          moduleServer.consumeBinary(response.backingToken),
        ),
        instrumental: createStereoAudio(
          audio,
          moduleServer.consumeBinary(response.instrumentalToken),
        ),
      };
    } finally {
      await browser.close();
    }
  } finally {
    await moduleServer.close();
  }
};
