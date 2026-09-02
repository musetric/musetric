import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import { readGpuSupport } from './browserGpuSupport.js';
import {
  deliverFileApiName,
  type ExecutorMessage,
  type JobCommand,
  readJobCommand,
} from './jobProtocol.js';

const send = (socket: WebSocket, message: ExecutorMessage): void => {
  socket.send(JSON.stringify(message));
};

const uploadFile = async (
  command: JobCommand,
  name: string,
  bytes: ArrayBuffer,
): Promise<void> => {
  const response = await fetch(`${command.uploadUrl}${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload ${name}: HTTP ${response.status}`);
  }
};

const bindJobApis = (socket: WebSocket, command: JobCommand): void => {
  Reflect.set(
    globalThis,
    reportProgressApiName,
    (message: BrowserProgressMessage) => {
      send(socket, {
        type: 'progress',
        jobId: command.jobId,
        progress: message.progress,
      });
    },
  );
  Reflect.set(
    globalThis,
    deliverFileApiName,
    async (name: string, bytes: ArrayBuffer) => {
      await uploadFile(command, name, bytes);
    },
  );
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runJob = async (
  socket: WebSocket,
  command: JobCommand,
): Promise<void> => {
  try {
    bindJobApis(socket, command);
    const api: unknown = Reflect.get(globalThis, command.api);
    if (typeof api !== 'function') {
      throw new Error(`Browser API ${command.api} is not initialized`);
    }
    const result: unknown = await Reflect.apply(api, undefined, [
      command.request,
    ]);
    send(socket, { type: 'result', jobId: command.jobId, result });
  } catch (error) {
    send(socket, {
      type: 'failed',
      jobId: command.jobId,
      error: describeError(error),
    });
  }
};

export const startJobExecutor = (jobUrl: string): void => {
  const socket = new WebSocket(jobUrl);
  socket.addEventListener('open', () => {
    void readGpuSupport().then((support) => {
      send(socket, { type: 'ready', ...support });
    });
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return;
    }
    const command = readJobCommand(event.data);
    if (command) {
      void runJob(socket, command);
    }
  });
};
