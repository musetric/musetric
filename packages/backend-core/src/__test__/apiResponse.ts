import { createHash } from 'node:crypto';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import { startRustProxy } from '@musetric/server';
import { type FastifyInstance, type InjectOptions } from 'fastify';
import { createServerApp } from '../app.js';
import { createProjectFixture } from './projectFixture.js';
import {
  createStorageWorkspace,
  type StorageWorkspace,
} from './storageWorkspace.js';

const snapshotHeaders = [
  'cache-control',
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
];

const readHeaders = (
  read: (name: string) => string | undefined,
): Record<string, string> => {
  const result: Record<string, string> = {};
  snapshotHeaders.forEach((name) => {
    const value = read(name);
    if (value !== undefined) {
      result[name] = value;
    }
  });
  return result;
};

const readBody = (contentType: string, payload: Buffer): unknown => {
  if (payload.byteLength === 0) {
    return undefined;
  }
  if (contentType.startsWith('application/json')) {
    return JSON.parse(payload.toString('utf8'));
  }
  return {
    byteLength: payload.byteLength,
    sha256: createHash('sha256').update(payload).digest('hex'),
  };
};

export type CaptureOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  payload?: FormData;
  body?: Record<string, unknown>;
};

export type ApiSnapshot = {
  route: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

const createSnapshot = (
  options: Pick<CaptureOptions, 'method' | 'url'>,
  status: number,
  headers: Record<string, string>,
  payload: Buffer,
): ApiSnapshot => ({
  route: `${options.method} ${options.url}`,
  status,
  headers,
  body: readBody(headers['content-type'] ?? '', payload),
});

export type ApiClient = {
  capture: (options: CaptureOptions) => Promise<ApiSnapshot>;
  captureStream: (url: string) => Promise<ApiSnapshot>;
};

const createInjectClient = (app: FastifyInstance): ApiClient => ({
  capture: async (options) => {
    const inject: InjectOptions = {
      method: options.method,
      url: options.url,
      headers: options.headers,
      payload: options.payload ?? options.body,
    };
    const response = await app.inject(inject);
    const headers = readHeaders((name) => {
      const value = response.headers[name];
      return value === undefined ? undefined : String(value);
    });
    return createSnapshot(
      options,
      response.statusCode,
      headers,
      response.rawPayload,
    );
  },
  captureStream: async (url) => {
    const inject: InjectOptions = { method: 'GET', url, payloadAsStream: true };
    const response = await app.inject(inject);
    const chunk: unknown = await new Promise((resolve) => {
      response.stream().once('data', resolve);
    });
    response.stream().destroy();
    return {
      route: `GET ${url}`,
      status: response.statusCode,
      headers: readHeaders((name) => {
        const value = response.headers[name];
        return value === undefined ? undefined : String(value);
      }),
      body: Buffer.isBuffer(chunk) ? chunk.toString('utf8') : undefined,
    };
  },
});

const createRequestInit = (options: CaptureOptions): RequestInit => {
  if (options.body !== undefined) {
    return {
      method: options.method,
      headers: { ...options.headers, 'content-type': 'application/json' },
      body: JSON.stringify(options.body),
    };
  }
  return {
    method: options.method,
    headers: options.headers,
    body: options.payload,
  };
};

const createHttpClient = (baseUrl: string): ApiClient => ({
  capture: async (options) => {
    const response = await fetch(
      `${baseUrl}${options.url}`,
      createRequestInit(options),
    );
    const headers = readHeaders(
      (name) => response.headers.get(name) ?? undefined,
    );
    const payload = Buffer.from(await response.arrayBuffer());
    return createSnapshot(options, response.status, headers, payload);
  },
  captureStream: async (url) => {
    const response = await fetch(`${baseUrl}${url}`);
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    await reader?.cancel();
    return {
      route: `GET ${url}`,
      status: response.status,
      headers: readHeaders((name) => response.headers.get(name) ?? undefined),
      body: chunk?.value
        ? Buffer.from(chunk.value).toString('utf8')
        : undefined,
    };
  },
});

const listenLocally = async (app: FastifyInstance): Promise<string> => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('the test server failed to bind a local port');
  }
  return `http://127.0.0.1:${String(address.port)}`;
};

export type Transport = 'inject' | 'http' | 'proxy';

export type ServerRun<Result> = (
  client: ApiClient,
  workspace: StorageWorkspace,
) => Promise<Result>;

const withClient = async <Result>(
  app: FastifyInstance,
  workspace: StorageWorkspace,
  transport: Transport,
  run: ServerRun<Result>,
): Promise<Result> => {
  if (transport === 'inject') {
    return await run(createInjectClient(app), workspace);
  }
  const upstream = await listenLocally(app);
  if (transport === 'http') {
    return await run(createHttpClient(upstream), workspace);
  }
  const proxy = await startRustProxy({
    upstream,
    listen: '127.0.0.1:0',
    databasePath: workspace.config.databasePath,
    blobsPath: workspace.config.blobsPath,
    ffmpegPath: ffmpegPath(),
    ffprobePath: ffprobePath(),
    processing: false,
  });
  try {
    return await run(createHttpClient(proxy.url), workspace);
  } finally {
    await proxy.close();
  }
};

export const withTestServer = async <Result>(
  run: ServerRun<Result>,
  transport: Transport = 'inject',
): Promise<Result> => {
  const workspace = createStorageWorkspace();
  await createProjectFixture(workspace);
  const app = await createServerApp(workspace.config, {
    gpuPageHostFactory: () => {
      throw new Error('A test must not reach the GPU host');
    },
  });
  await app.ready();
  try {
    return await withClient(app, workspace, transport, run);
  } finally {
    await app.close();
    workspace.remove();
  }
};
