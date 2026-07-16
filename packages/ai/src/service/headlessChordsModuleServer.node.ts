import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Logger } from '@musetric/utils';
import * as vite from 'vite';

const getPackageRoot = (): string =>
  dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const getFileToken = (path: string): string => {
  const { mtimeMs, size } = statSync(path);
  return createHash('sha256')
    .update(`${path}:${size}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
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

type ChordsFileRoute = {
  prefix: string;
  files: Map<string, string>;
  missingMessage: string;
};

const serveRegisteredFile = async (
  pathname: string,
  response: ServerResponse,
  route: ChordsFileRoute,
): Promise<boolean> => {
  if (!pathname.startsWith(route.prefix)) {
    return false;
  }
  const [token] = pathname.slice(route.prefix.length).split('/');
  const path = token ? route.files.get(token) : undefined;
  if (path === undefined) {
    response.writeHead(404);
    response.end(route.missingMessage);
    return true;
  }
  await sendFile(path, response);
  return true;
};

const serveChordsPage = async (
  pathname: string,
  response: ServerResponse,
  viteServer: vite.ViteDevServer,
): Promise<boolean> => {
  if (pathname !== '/chords-service') {
    return false;
  }
  const html = await viteServer.transformIndexHtml(
    pathname,
    '<!doctype html><script type="module" src="/src/service/browserChordsEntry.ts"></script>',
  );
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
  return true;
};

const servePcm = (
  pathname: string,
  response: ServerResponse,
  getPcm: () => Buffer | undefined,
): boolean => {
  if (pathname !== '/pcm') {
    return false;
  }
  const pcm = getPcm();
  if (pcm === undefined) {
    response.writeHead(404);
    response.end('pcm not set');
    return true;
  }
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(pcm);
  return true;
};

type HandleModuleRequestOptions = {
  request: IncomingMessage;
  response: ServerResponse;
  viteServer: vite.ViteDevServer;
  fileRoutes: ChordsFileRoute[];
  getPcm: () => Buffer | undefined;
  logger: Logger;
};

const handleModuleRequest = async (
  options: HandleModuleRequestOptions,
): Promise<void> => {
  const { request, response, viteServer, fileRoutes, getPcm, logger } = options;
  const requestUrl = request.url ?? '/';
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (await serveChordsPage(url.pathname, response, viteServer)) {
    return;
  }
  if (servePcm(url.pathname, response, getPcm)) {
    return;
  }
  for (const route of fileRoutes) {
    if (await serveRegisteredFile(url.pathname, response, route)) {
      return;
    }
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  viteServer.middlewares(request, response, () => {
    logger.warn({ url: requestUrl }, 'Chords service route not found');
    response.writeHead(404);
    response.end('not found');
  });
};

type RegisterChordsFileOptions = {
  path: string;
  files: Map<string, string>;
  baseUrl: string;
  route: string;
  label: string;
};

const registerFile = (options: RegisterChordsFileOptions): string => {
  const { path, files, baseUrl, route, label } = options;
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
  const token = getFileToken(path);
  files.set(token, path);
  return `${baseUrl}${route}${token}`;
};

export type ChordsModuleServer = {
  baseUrl: string;
  pcmUrl: string;
  setPcm: (pcm: Buffer) => void;
  registerModelFile: (path: string) => string;
  registerPlanFile: (path: string) => string;
  registerPlanManifestFile: (path: string) => string;
  close: () => Promise<void>;
};

type CreateChordsModuleServerOptions = {
  logger: Logger;
};

export const createChordsModuleServer = async (
  options: CreateChordsModuleServerOptions,
): Promise<ChordsModuleServer> => {
  const { logger } = options;
  const packageRoot = getPackageRoot();
  const packagesRoot = dirname(packageRoot);
  const repositoryRoot = dirname(packagesRoot);
  const browserEntry = join(packageRoot, 'src/service/browserChordsEntry.ts');
  if (!existsSync(browserEntry)) {
    throw new Error(`AI chords browser entry not found at ${browserEntry}`);
  }
  const modelFiles = new Map<string, string>();
  const planFiles = new Map<string, string>();
  const planManifestFiles = new Map<string, string>();
  const fileRoutes: ChordsFileRoute[] = [
    {
      prefix: '/models/',
      files: modelFiles,
      missingMessage: 'model not found',
    },
    {
      prefix: '/plans/',
      files: planFiles,
      missingMessage: 'plan not found',
    },
    {
      prefix: '/plan-manifests/',
      files: planManifestFiles,
      missingMessage: 'plan manifest not found',
    },
  ];
  let pcm: Buffer | undefined = undefined;
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
          find: '@musetric/cqt/gpu',
          replacement: join(packagesRoot, 'cqt/src/index.ts'),
        },
        {
          find: '@musetric/cqt',
          replacement: join(packagesRoot, 'cqt/src/index.es.ts'),
        },
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
    optimizeDeps: { include: ['onnxruntime-web/webgpu'] },
  });
  const server = createServer((request, response) => {
    void handleModuleRequest({
      request,
      response,
      viteServer,
      fileRoutes,
      getPcm: () => pcm,
      logger,
    }).catch((error: unknown) => {
      logger.error({ error }, 'Chords service request failed');
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
    throw new Error('Chords service failed to bind a local HTTP port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    pcmUrl: `${baseUrl}/pcm`,
    setPcm: (nextPcm) => {
      pcm = nextPcm;
    },
    registerModelFile: (path) =>
      registerFile({
        path,
        files: modelFiles,
        baseUrl,
        route: '/models/',
        label: 'ChordNet model',
      }),
    registerPlanFile: (path) =>
      registerFile({
        path,
        files: planFiles,
        baseUrl,
        route: '/plans/',
        label: 'CQT plan',
      }),
    registerPlanManifestFile: (path) =>
      registerFile({
        path,
        files: planManifestFiles,
        baseUrl,
        route: '/plan-manifests/',
        label: 'CQT plan manifest',
      }),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await viteServer.close();
    },
  };
};
