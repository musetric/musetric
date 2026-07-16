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

const filesRoute = '/files/';

const serveRegisteredFile = async (
  pathname: string,
  response: ServerResponse,
  files: Map<string, string>,
): Promise<boolean> => {
  if (!pathname.startsWith(filesRoute)) {
    return false;
  }
  const [token] = pathname.slice(filesRoute.length).split('/');
  const path = token ? files.get(token) : undefined;
  if (path === undefined) {
    response.writeHead(404);
    response.end('file not found');
    return true;
  }
  await sendFile(path, response);
  return true;
};

type GpuPage = {
  route: string;
  entryModule: string;
  label: string;
};

const servePage = async (
  pathname: string,
  response: ServerResponse,
  viteServer: vite.ViteDevServer,
  page: GpuPage,
): Promise<boolean> => {
  if (pathname !== page.route) {
    return false;
  }
  const html = await viteServer.transformIndexHtml(
    pathname,
    `<!doctype html><script type="module" src="/${page.entryModule}"></script>`,
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
  page: GpuPage;
  files: Map<string, string>;
  getPcm: () => Buffer | undefined;
  logger: Logger;
};

const handleModuleRequest = async (
  options: HandleModuleRequestOptions,
): Promise<void> => {
  const { request, response, viteServer, page, files, getPcm, logger } =
    options;
  const requestUrl = request.url ?? '/';
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (await servePage(url.pathname, response, viteServer, page)) {
    return;
  }
  if (servePcm(url.pathname, response, getPcm)) {
    return;
  }
  if (await serveRegisteredFile(url.pathname, response, files)) {
    return;
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  viteServer.middlewares(request, response, () => {
    logger.warn({ url: requestUrl }, `${page.label} route not found`);
    response.writeHead(404);
    response.end('not found');
  });
};

const createViteServer = async (
  packageRoot: string,
): Promise<vite.ViteDevServer> => {
  const packagesRoot = dirname(packageRoot);
  const repositoryRoot = dirname(packagesRoot);
  return vite.createServer({
    root: packageRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {
      middlewareMode: true,
      hmr: false,
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
};

export type GpuModuleServer = {
  baseUrl: string;
  pageUrl: string;
  pcmUrl: string;
  setPcm: (pcm: Buffer) => void;
  registerFile: (path: string) => string;
  close: () => Promise<void>;
};

export type CreateGpuModuleServerOptions = {
  logger: Logger;
  label: string;
  pageRoute: string;
  entryModule: string;
};

export const createGpuModuleServer = async (
  options: CreateGpuModuleServerOptions,
): Promise<GpuModuleServer> => {
  const { logger, label, pageRoute, entryModule } = options;
  const packageRoot = getPackageRoot();
  const entryPath = join(packageRoot, entryModule);
  if (!existsSync(entryPath)) {
    throw new Error(`${label} browser entry not found at ${entryPath}`);
  }
  const files = new Map<string, string>();
  let pcm: Buffer | undefined = undefined;
  const viteServer = await createViteServer(packageRoot);
  const server = createServer((request, response) => {
    void handleModuleRequest({
      request,
      response,
      viteServer,
      page: { route: pageRoute, entryModule, label },
      files,
      getPcm: () => pcm,
      logger,
    }).catch((error: unknown) => {
      logger.error({ error }, `${label} request failed`);
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
    throw new Error(`${label} failed to bind a local HTTP port`);
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    pageUrl: `${baseUrl}${pageRoute}`,
    pcmUrl: `${baseUrl}/pcm`,
    setPcm: (nextPcm) => {
      pcm = nextPcm;
    },
    registerFile: (path) => {
      if (!existsSync(path)) {
        throw new Error(`${label} file not found at ${path}`);
      }
      const token = getFileToken(path);
      files.set(token, path);
      return `${baseUrl}${filesRoute}${token}`;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await viteServer.close();
    },
  };
};
