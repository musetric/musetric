import { createHash } from 'node:crypto';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import { startRustProxy } from '../rustProxy.js';
import { serverResourcesPath } from './globalSetup.js';
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

export type ApiClient = {
  capture: (options: CaptureOptions) => Promise<ApiSnapshot>;
  captureStream: (url: string) => Promise<ApiSnapshot>;
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

export type ServerRun<Result> = (
  client: ApiClient,
  workspace: StorageWorkspace,
) => Promise<Result>;

export const withTestServer = async <Result>(
  run: ServerRun<Result>,
): Promise<Result> => {
  const workspace = createStorageWorkspace();
  const server = await startRustProxy({
    listen: '127.0.0.1:0',
    databasePath: workspace.paths.databasePath,
    blobsPath: workspace.paths.blobsPath,
    ffmpegPath: ffmpegPath(),
    ffprobePath: ffprobePath(),
    modelsPath: workspace.paths.modelsPath,
    browserBundlePath: workspace.paths.browserBundlePath,
    publicPath: workspace.paths.publicPath,
    processing: false,
    resourcesPath: serverResourcesPath,
  });
  try {
    await createProjectFixture(workspace);
    return await run(createHttpClient(server.url), workspace);
  } finally {
    await server.close();
    workspace.remove();
  }
};
