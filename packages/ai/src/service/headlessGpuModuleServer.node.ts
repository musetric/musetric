import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { basename } from 'node:path';
import { type Logger } from '@musetric/utils';
import { browserLoaderHtml, serveBundleAsset } from './browserBundle.node.js';
import { sendFile } from './httpFile.node.js';

const getFileToken = (path: string): string => {
  const { mtimeMs, size } = statSync(path);
  return createHash('sha256')
    .update(`${path}:${size}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
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

const pageRoute = '/';

const servePage = (pathname: string, response: ServerResponse): boolean => {
  if (pathname !== pageRoute) {
    return false;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(browserLoaderHtml);
  return true;
};

const servePcm = (
  pathname: string,
  response: ServerResponse,
  pcm: Buffer,
): boolean => {
  if (pathname !== '/pcm') {
    return false;
  }
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(pcm);
  return true;
};

export type GpuModuleRoute = (
  url: URL,
  response: ServerResponse,
) => boolean | Promise<boolean>;

type HandleModuleRequestOptions = {
  request: IncomingMessage;
  response: ServerResponse;
  label: string;
  files: Map<string, string>;
  pcm: Buffer;
  routes: GpuModuleRoute[];
  browserBundlePath: string;
  logger: Logger;
};

const handleModuleRequest = async (
  options: HandleModuleRequestOptions,
): Promise<void> => {
  const { request, response, label, files, pcm, routes } = options;
  const { browserBundlePath, logger } = options;
  const requestUrl = request.url ?? '/';
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (servePage(url.pathname, response)) {
    return;
  }
  if (servePcm(url.pathname, response, pcm)) {
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
  for (const route of routes) {
    if (await route(url, response)) {
      return;
    }
  }
  if (await serveBundleAsset(browserBundlePath, url.pathname, response)) {
    return;
  }
  logger.warn({ url: requestUrl }, `${label} route not found`);
  response.writeHead(404);
  response.end('not found');
};

export type GpuModuleServer = {
  baseUrl: string;
  pageUrl: string;
  pcmUrl: string;
  registerFile: (path: string) => string;
  close: () => Promise<void>;
};

export type CreateGpuModuleServerOptions = {
  logger: Logger;
  label: string;
  pcm: Buffer;
  routes?: GpuModuleRoute[];
  browserBundlePath: string;
};

export const createGpuModuleServer = async (
  options: CreateGpuModuleServerOptions,
): Promise<GpuModuleServer> => {
  const { logger, label, pcm, routes = [], browserBundlePath } = options;
  const files = new Map<string, string>();
  const server = createServer((request, response) => {
    void handleModuleRequest({
      request,
      response,
      label,
      files,
      pcm,
      routes,
      browserBundlePath,
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
    registerFile: (path) => {
      if (!existsSync(path)) {
        throw new Error(`${label} file not found at ${path}`);
      }
      const token = getFileToken(path);
      files.set(token, path);
      return `${baseUrl}${filesRoute}${token}/${basename(path)}`;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
