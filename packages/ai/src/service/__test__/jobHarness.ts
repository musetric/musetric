import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  type ExecutorJobMessage,
  type ExecutorReady,
  jobSocketPath,
  jobUrlParameter,
  readExecutorMessage,
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

export type UnitDoneEvent = {
  attemptId: string;
  unit: number;
};

export type FakeHost = {
  pageUrl: string;
  ready: Promise<ExecutorReady>;
  phases: ExecutorJobMessage[];
  unitDone: UnitDoneEvent[];
  windows: Map<string, Buffer>;
  outputs: Map<string, Buffer>;
  run: (api: string, request: unknown) => Promise<unknown>;
  sendUnit: (attemptId: string, unit: number, unitCount: number) => void;
  sendUnitClose: (attemptId: string) => void;
  close: () => Promise<void>;
};

export const startFakeHost = async (): Promise<FakeHost> => {
  const phases: ExecutorJobMessage[] = [];
  const unitDone: UnitDoneEvent[] = [];
  const windows = new Map<string, Buffer>();
  const outputs = new Map<string, Buffer>();
  const jobs = new Map<string, PendingJob>();
  const sockets: WebSocket[] = [];
  const pending: string[] = [];
  const connected = Promise.withResolvers<WebSocket>();
  const ready = Promise.withResolvers<ExecutorReady>();

  const sendAll = (text: string): void => {
    if (sockets.length === 0) {
      pending.push(text);
      return;
    }
    for (const socket of sockets) {
      socket.send(text);
    }
  };

  const receive = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const window = /\/attempt\/([^/]+)\/unit\/(\d+)$/.exec(url.pathname);
    if (request.method === 'GET' && window) {
      const key = `${window[1]}/${window[2]}`;
      const found = windows.get(key);
      if (!found) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(found);
      return;
    }
    const output = /\/attempt\/([^/]+)\/unit\/(\d+)\/([^/]+)$/.exec(
      url.pathname,
    );
    if (request.method === 'PUT' && output) {
      const key = `${output[1]}/${output[2]}/${output[3]}`;
      outputs.set(key, await readBody(request));
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end('not found');
  };

  const server = createServer((request, response) => {
    void receive(request, response);
  });
  const socketServer = new WebSocketServer({ server, path: jobSocketPath });
  socketServer.on('connection', (socket) => {
    sockets.push(socket);
    connected.resolve(socket);
    for (const text of pending.splice(0)) {
      socket.send(text);
    }
    socket.on('message', (data) => {
      const message = readExecutorMessage(String(data));
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        ready.resolve(message);
        return;
      }
      if (message.type === 'loading' || message.type === 'running') {
        phases.push(message);
        return;
      }
      if (message.type === 'unitOpened') {
        return;
      }
      if (message.type === 'unitDone') {
        unitDone.push({ attemptId: message.attemptId, unit: message.unit });
        return;
      }
      const job = jobs.get(message.jobId);
      if (!job) {
        return;
      }
      jobs.delete(message.jobId);
      if (message.type === 'result') {
        job.resolve(message.result);
        return;
      }
      job.reject(new Error(message.error));
    });
  });

  const baseUrl = await listenLocally(server);
  const socketUrl = `${baseUrl.replace('http://', 'ws://')}${jobSocketPath}`;
  const pageUrl = `${baseUrl}/?${jobUrlParameter}=${encodeURIComponent(socketUrl)}`;

  const active = async (): Promise<WebSocket> => await connected.promise;

  return {
    pageUrl,
    ready: ready.promise,
    phases,
    unitDone,
    windows,
    outputs,
    run: async (api, request) => {
      const socket = await active();
      const jobId = crypto.randomUUID();
      const answered = new Promise<unknown>((resolve, reject) => {
        jobs.set(jobId, { resolve, reject });
      });
      socket.send(
        JSON.stringify({
          type: 'job',
          jobId,
          api,
          request,
        }),
      );
      return answered;
    },
    sendUnit: (attemptId, unit, unitCount) => {
      sendAll(
        JSON.stringify({
          type: 'unit',
          jobId: 'unit-pump',
          attemptId,
          unit,
          unitCount,
        }),
      );
    },
    sendUnitClose: (attemptId) => {
      sendAll(
        JSON.stringify({
          type: 'unitClose',
          jobId: 'unit-pump',
          attemptId,
        }),
      );
    },
    close: async () => {
      socketServer.clients.forEach((client) => {
        client.terminate();
      });
      socketServer.close();
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
