import { readGpuSupport } from './browserGpuSupport.js';
import { type BrowserJobApis } from './browserJob.js';
import { createUnitServer } from './browserUnitServing.js';
import {
  type ExecutorMessage,
  isPingCommand,
  type JobCommand,
  readJobCommand,
  readUnitEvent,
} from './jobProtocol.js';

export const executorLockName = 'musetric-executor';

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

const pause = async (delayMs: number, signal: AbortSignal): Promise<void> => {
  const paused = Promise.withResolvers<void>();
  const timer = setTimeout(paused.resolve, delayMs);
  const cancel = (): void => {
    clearTimeout(timer);
    paused.resolve();
  };
  signal.addEventListener('abort', cancel, { once: true });
  await paused.promise;
  signal.removeEventListener('abort', cancel);
};

type RunningJob = {
  job: Promise<void> | undefined;
  failed: boolean;
};

const serveConnection = async (
  socketUrl: string,
  apis: BrowserJobApis,
  signal: AbortSignal,
): Promise<boolean> => {
  const socket = new WebSocket(socketUrl);
  const send = (message: ExecutorMessage): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  const unitServer = createUnitServer({
    unitOpened: (jobId, attemptId) => {
      send({ type: 'unitOpened', jobId, attemptId });
    },
    unitDone: (jobId, attemptId, unit) => {
      send({ type: 'unitDone', jobId, attemptId, unit });
    },
  });
  const running: RunningJob = { job: undefined, failed: false };
  const close = (): void => {
    socket.close();
  };

  const runJob = async (command: JobCommand): Promise<void> => {
    try {
      const api = apis[command.api];
      if (!api) {
        throw new Error(`Browser API ${command.api} is not initialized`);
      }
      const result = await api(command.request, {
        reportLoading: () => {
          send({ type: 'loading', jobId: command.jobId });
        },
        serveUnits: async (serving) =>
          await unitServer.serve(command.jobId, serving),
      });
      send({ type: 'result', jobId: command.jobId, result });
    } catch (error) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      send({
        type: 'failed',
        jobId: command.jobId,
        error: describeError(error),
      });
      running.failed = true;
      close();
    }
  };

  const acceptJob = (command: JobCommand): void => {
    if (running.job !== undefined) {
      send({
        type: 'failed',
        jobId: command.jobId,
        error: 'The executor is already running a job',
      });
      return;
    }
    running.job = runJob(command).finally(() => {
      running.job = undefined;
    });
  };

  const closed = Promise.withResolvers<void>();
  signal.addEventListener('abort', close, { once: true });
  socket.addEventListener('close', () => {
    closed.resolve();
  });
  socket.addEventListener('error', () => {
    closed.resolve();
  });
  socket.addEventListener('open', () => {
    void readGpuSupport().then((support) => {
      send({ type: 'ready', ...support });
    });
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return;
    }
    if (isPingCommand(event.data)) {
      send({ type: 'pong' });
      return;
    }
    const unitEvent = readUnitEvent(event.data);
    if (unitEvent) {
      unitServer.dispatch(unitEvent);
      return;
    }
    const command = readJobCommand(event.data);
    if (command) {
      acceptJob(command);
    }
  });

  await closed.promise;
  signal.removeEventListener('abort', close);
  close();
  await unitServer.abandon('the executor lost its connection to the host');
  await running.job;
  return running.failed;
};

export type JobExecutorOptions = {
  jobUrl: string;
  apis: BrowserJobApis;
  reconnectDelayMs: number;
  restart: () => void;
};

export type JobExecutor = {
  stop: () => Promise<void>;
};

export const startJobExecutor = (options: JobExecutorOptions): JobExecutor => {
  const socketUrl = readSocketUrl(options.jobUrl);
  if (socketUrl === undefined) {
    throw new Error('The job executor accepts a local socket url only');
  }
  const controller = new AbortController();
  const { signal } = controller;
  const stopped = navigator.locks
    .request(executorLockName, { signal }, async () => {
      while (!signal.aborted) {
        if (await serveConnection(socketUrl, options.apis, signal)) {
          return true;
        }
        await pause(options.reconnectDelayMs, signal);
      }
      return false;
    })
    .then((failed) => {
      if (failed) {
        options.restart();
      }
    })
    .catch((error: unknown) => {
      if (!signal.aborted) {
        throw error;
      }
    });
  return {
    stop: async () => {
      controller.abort();
      await stopped;
    },
  };
};
