import { type ForegroundBridge } from './androidForeground.js';
import { readGpuSupport } from './browserGpuSupport.js';
import { type BrowserJobApis } from './browserJob.js';
import { createUnitServer } from './browserUnitServing.js';
import {
  type ExecutorMessage,
  type JobCommand,
  readJobCommand,
  readUnitEvent,
} from './jobProtocol.js';

const send = (socket: WebSocket, message: ExecutorMessage): void => {
  socket.send(JSON.stringify(message));
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]', '::1'];

const readSocketUrl = (jobUrl: string): string | undefined => {
  const url = new URL(jobUrl);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return undefined;
  }
  return loopbackHosts.includes(url.hostname) ? url.toString() : undefined;
};

export type JobExecutorOptions = {
  jobUrl: string;
  apis: BrowserJobApis;
  foreground: ForegroundBridge | undefined;
};

export const startJobExecutor = (options: JobExecutorOptions): void => {
  const socketUrl = readSocketUrl(options.jobUrl);
  if (socketUrl === undefined) {
    throw new Error('The job executor accepts a local socket url only');
  }
  const socket = new WebSocket(socketUrl);
  const unitServer = createUnitServer({
    unitOpened: (jobId, attemptId) => {
      send(socket, { type: 'unitOpened', jobId, attemptId });
    },
    unitDone: (jobId, attemptId, unit) => {
      send(socket, { type: 'unitDone', jobId, attemptId, unit });
    },
  });
  let runningJobs = 0;

  const runJob = async (command: JobCommand): Promise<void> => {
    runningJobs += 1;
    if (runningJobs === 1) {
      options.foreground?.setActive(true);
    }
    try {
      const api = options.apis[command.api];
      if (!api) {
        throw new Error(`Browser API ${command.api} is not initialized`);
      }
      const result = await api(command.request, {
        reportLoading: () => {
          send(socket, { type: 'loading', jobId: command.jobId });
        },
        serveUnits: async (serving) =>
          await unitServer.serve(command.jobId, serving),
      });
      send(socket, { type: 'result', jobId: command.jobId, result });
    } catch (error) {
      send(socket, {
        type: 'failed',
        jobId: command.jobId,
        error: describeError(error),
      });
    } finally {
      runningJobs -= 1;
      if (runningJobs === 0) {
        options.foreground?.setActive(false);
      }
    }
  };

  socket.addEventListener('close', () => {
    unitServer.abandon('the executor lost its connection to the host');
  });
  socket.addEventListener('error', () => {
    unitServer.abandon('the executor connection to the host failed');
  });
  socket.addEventListener('open', () => {
    void readGpuSupport().then((support) => {
      send(socket, { type: 'ready', ...support });
    });
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return;
    }
    const unitEvent = readUnitEvent(event.data);
    if (unitEvent) {
      unitServer.dispatch(unitEvent);
      return;
    }
    const command = readJobCommand(event.data);
    if (command) {
      void runJob(command);
    }
  });
};
