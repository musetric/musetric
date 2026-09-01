import { createHash } from 'node:crypto';
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

export const withTestServer = async <Result>(
  run: (app: FastifyInstance, workspace: StorageWorkspace) => Promise<Result>,
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
    return await run(app, workspace);
  } finally {
    await app.close();
    workspace.remove();
  }
};

const readHeaders = (
  headers: Record<string, unknown>,
): Record<string, string> => {
  const result: Record<string, string> = {};
  snapshotHeaders.forEach((name) => {
    const value = headers[name];
    if (value !== undefined) {
      result[name] = String(value);
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

export const captureResponse = async (
  app: FastifyInstance,
  options: CaptureOptions,
): Promise<ApiSnapshot> => {
  const inject: InjectOptions = {
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload ?? options.body,
  };
  const response = await app.inject(inject);
  const headers = readHeaders(response.headers);
  return {
    route: `${options.method} ${options.url}`,
    status: response.statusCode,
    headers,
    body: readBody(headers['content-type'] ?? '', response.rawPayload),
  };
};

export const captureStream = async (
  app: FastifyInstance,
  url: string,
): Promise<ApiSnapshot> => {
  const inject: InjectOptions = { method: 'GET', url, payloadAsStream: true };
  const response = await app.inject(inject);
  const chunk: unknown = await new Promise((resolve) => {
    response.stream().once('data', resolve);
  });
  response.stream().destroy();
  return {
    route: `GET ${url}`,
    status: response.statusCode,
    headers: readHeaders(response.headers),
    body: Buffer.isBuffer(chunk) ? chunk.toString('utf8') : undefined,
  };
};
