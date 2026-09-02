import { mkdir, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { dirname } from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { type CreateGpuPageOptions, type GpuPage } from './gpuPageHost.node.js';
import {
  type ExecutorJobMessage,
  type JobCommand,
  jobSocketPath,
  jobUrlParameter,
  readExecutorMessage,
  uploadRoute,
} from './jobProtocol.js';

const readyTimeoutMs = 30_000;

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
};

const listenLocally = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('the job executor host failed to bind a local HTTP port');
  }
  return `http://127.0.0.1:${String(address.port)}`;
};

const closeHost = async (
  server: Server,
  sockets: WebSocketServer,
): Promise<void> => {
  sockets.clients.forEach((client) => {
    client.terminate();
  });
  sockets.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
};

const createJobUrl = (pageUrl: string, baseUrl: string): string => {
  const socketUrl = `${baseUrl.replace('http://', 'ws://')}${jobSocketPath}`;
  const url = new URL(pageUrl);
  url.searchParams.set(jobUrlParameter, socketUrl);
  return url.toString();
};

type ExecutorState = {
  socket: Promise<WebSocket>;
  ready: Promise<void>;
};

const waitForExecutor = (
  sockets: WebSocketServer,
  label: string,
  requireShaderF16: boolean,
  onMessage: (message: ExecutorJobMessage) => void,
): ExecutorState => {
  const socket = Promise.withResolvers<WebSocket>();
  const ready = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    ready.reject(new Error(`${label} executor did not connect in time`));
  }, readyTimeoutMs);
  sockets.on('connection', (connected) => {
    socket.resolve(connected);
    connected.on('message', (data) => {
      const message = readExecutorMessage(String(data));
      if (!message) {
        return;
      }
      if (message.type !== 'ready') {
        onMessage(message);
        return;
      }
      clearTimeout(timer);
      if (!message.adapter) {
        ready.reject(new Error(`${label} could not get a WebGPU adapter`));
        return;
      }
      if (requireShaderF16 && !message.shaderF16) {
        ready.reject(
          new Error(`${label} adapter does not support required shader-f16`),
        );
        return;
      }
      ready.resolve();
    });
  });
  return { socket: socket.promise, ready: ready.promise };
};

type PendingUpload = {
  targets: Map<string, string>;
  remaining: Set<string>;
  resolve: () => void;
  reject: (error: Error) => void;
};

const refuseUpload = (
  response: ServerResponse,
  uploads: PendingUpload[],
  name: string,
): void => {
  response.writeHead(400);
  response.end('unexpected upload');
  uploads.forEach((upload) => {
    upload.reject(new Error(`Unexpected executor upload: ${name}`));
  });
};

const handleUpload = async (
  request: IncomingMessage,
  response: ServerResponse,
  uploads: PendingUpload[],
): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'PUT' || !url.pathname.startsWith(uploadRoute)) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  const name = decodeURIComponent(url.pathname.slice(uploadRoute.length));
  const pending = uploads.find((upload) => upload.remaining.has(name));
  const target = pending?.targets.get(name);
  if (!pending || target === undefined) {
    refuseUpload(response, uploads, name);
    return;
  }
  const body = await readBody(request);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  pending.remaining.delete(name);
  if (pending.remaining.size === 0) {
    pending.resolve();
  }
  response.writeHead(204);
  response.end();
};

export type OpenedPage = {
  close: () => Promise<void>;
};

export type OpenJobPage = (url: string) => Promise<OpenedPage>;

export type CreateJobGpuPageOptions = CreateGpuPageOptions & {
  open: OpenJobPage;
};

type PendingJob = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export const createJobGpuPage = async (
  options: CreateJobGpuPageOptions,
): Promise<GpuPage> => {
  const { label, pageUrl, apiName, requireShaderF16, onProgress, open } =
    options;
  const jobs = new Map<string, PendingJob>();
  const uploads: PendingUpload[] = [];
  const server = createServer((request, response) => {
    void handleUpload(request, response, uploads);
  });
  const sockets = new WebSocketServer({ server, path: jobSocketPath });
  const executor = waitForExecutor(
    sockets,
    label,
    requireShaderF16,
    (message) => {
      if (message.type === 'progress') {
        void onProgress?.(message.progress);
        return;
      }
      const pending = jobs.get(message.jobId);
      if (!pending) {
        return;
      }
      jobs.delete(message.jobId);
      if (message.type === 'result') {
        pending.resolve(message.result);
        return;
      }
      pending.reject(new Error(message.error));
    },
  );

  const baseUrl = await listenLocally(server);
  const uploadUrl = `${baseUrl}${uploadRoute}`;
  const page = await open(createJobUrl(pageUrl, baseUrl));
  try {
    await executor.ready;
  } catch (error) {
    await page.close();
    await closeHost(server, sockets);
    throw error;
  }
  const socket = await executor.socket;

  return {
    evaluate: async <Result>(request: unknown): Promise<Result> => {
      const jobId = globalThis.crypto.randomUUID();
      const command: JobCommand = {
        type: 'job',
        jobId,
        api: apiName,
        uploadUrl,
        request,
      };
      const answered = new Promise<unknown>((resolve, reject) => {
        jobs.set(jobId, { resolve, reject });
      });
      socket.send(JSON.stringify(command));
      const result = await answered;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return result as Result;
    },
    captureDownloads: async (targets) =>
      new Promise<void>((resolve, reject) => {
        uploads.push({
          targets,
          remaining: new Set(targets.keys()),
          resolve,
          reject,
        });
      }),
    close: async () => {
      await page.close();
      await closeHost(server, sockets);
    },
  };
};
