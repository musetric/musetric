import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  type ExecutorReady,
  jobSocketPath,
  jobUrlParameter,
  readExecutorMessage,
  uploadRoute,
} from '../jobProtocol.js';

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
    throw new Error('the fake host failed to bind a local HTTP port');
  }
  return `http://127.0.0.1:${String(address.port)}`;
};

type PendingJob = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export type FakeHost = {
  pageUrl: string;
  ready: Promise<ExecutorReady>;
  progress: number[];
  uploads: Map<string, Buffer>;
  run: (api: string, request: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

export const startFakeHost = async (): Promise<FakeHost> => {
  const uploads = new Map<string, Buffer>();
  const progress: number[] = [];
  const jobs = new Map<string, PendingJob>();
  const connected = Promise.withResolvers<WebSocket>();
  const ready = Promise.withResolvers<ExecutorReady>();

  const receive = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'PUT' || !url.pathname.startsWith(uploadRoute)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(uploadRoute.length));
    uploads.set(name, await readBody(request));
    response.writeHead(204);
    response.end();
  };

  const server = createServer((request, response) => {
    void receive(request, response);
  });
  const sockets = new WebSocketServer({ server, path: jobSocketPath });
  sockets.on('connection', (socket) => {
    connected.resolve(socket);
    socket.on('message', (data) => {
      const message = readExecutorMessage(String(data));
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        ready.resolve(message);
        return;
      }
      if (message.type === 'progress') {
        progress.push(message.progress);
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
    });
  });

  const baseUrl = await listenLocally(server);
  const socketUrl = `${baseUrl.replace('http://', 'ws://')}${jobSocketPath}`;
  const pageUrl = `${baseUrl}/?${jobUrlParameter}=${encodeURIComponent(socketUrl)}`;

  return {
    pageUrl,
    ready: ready.promise,
    progress,
    uploads,
    run: async (api, request) => {
      const socket = await connected.promise;
      const jobId = globalThis.crypto.randomUUID();
      const answered = new Promise<unknown>((resolve, reject) => {
        jobs.set(jobId, { resolve, reject });
      });
      socket.send(
        JSON.stringify({
          type: 'job',
          jobId,
          api,
          uploadUrl: `${baseUrl}${uploadRoute}`,
          request,
        }),
      );
      return answered;
    },
    close: async () => {
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
    },
  };
};

export const readSocketUrl = (pageUrl: string): string => {
  const found = new URL(pageUrl).searchParams.get(jobUrlParameter) ?? undefined;
  if (found === undefined) {
    throw new Error('the page url should carry the job socket url');
  }
  return found;
};
