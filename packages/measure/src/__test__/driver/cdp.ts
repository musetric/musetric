import { z } from 'zod';

const messageSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  sessionId: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

const attachedSchema = z.object({
  sessionId: z.string(),
  targetInfo: z.object({ type: z.string(), url: z.string() }),
});

const consoleSchema = z.object({
  args: z.array(
    z.object({
      value: z.unknown().optional(),
      description: z.string().optional(),
    }),
  ),
});

const evaluationSchema = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z
    .object({
      text: z.string(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
});

const requestSentSchema = z.object({
  requestId: z.string(),
  request: z.object({ url: z.string() }),
  wallTime: z.number(),
  timestamp: z.number(),
});

const requestEndSchema = z.object({
  requestId: z.string(),
  timestamp: z.number(),
});

const measureTag = '[measure]';

export type CdpMessage = z.infer<typeof messageSchema>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type MeasureLog = {
  channel: string;
  values: unknown[];
};

export type RequestLog = {
  url: string;
  sentAt: number;
  endedAt?: number;
  failed: boolean;
};

export type CdpPage = {
  evaluate: (expression: string) => Promise<unknown>;
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  logs: MeasureLog[];
  requests: () => RequestLog[];
  close: () => void;
};

export type WorkerScript = {
  urlPart: string;
  code: string;
};

export const connectPage = async (
  url: string,
  workerScript: WorkerScript,
  watchRequests: boolean,
): Promise<CdpPage> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error(`Cannot open ${url}`));
    });
  });
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const logs: MeasureLog[] = [];
  const requests = new Map<string, RequestLog & { offsetMs: number }>();

  const send = async (
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) =>
    new Promise<unknown>((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      socket.send(JSON.stringify({ id: nextId, method, params, sessionId }));
    });

  const evaluate = async (expression: string, sessionId?: string) => {
    const evaluation = evaluationSchema.parse(
      await send(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        sessionId,
      ),
    );
    if (evaluation.exceptionDetails) {
      const { exception, text } = evaluation.exceptionDetails;
      throw new Error(exception?.description ?? text);
    }
    return evaluation.result.value;
  };

  const watchTarget = async (sessionId?: string) => {
    await send('Runtime.enable', {}, sessionId);
    const watching = watchRequests
      ? send('Network.enable', {}, sessionId).catch(() => undefined)
      : undefined;
    await send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
    await watching;
  };

  const receive = (message: CdpMessage) => {
    if (message.method === 'Target.attachedToTarget') {
      const attached = attachedSchema.parse(message.params);
      void watchTarget(attached.sessionId)
        .then(async () => {
          if (attached.targetInfo.url.includes(workerScript.urlPart)) {
            await evaluate(workerScript.code, attached.sessionId);
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to prepare a worker for measuring', error);
        });
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      const sent = requestSentSchema.parse(message.params);
      if (!requests.has(sent.requestId)) {
        requests.set(sent.requestId, {
          url: sent.request.url,
          sentAt: sent.wallTime * 1000,
          offsetMs: (sent.wallTime - sent.timestamp) * 1000,
          failed: false,
        });
      }
      return;
    }
    if (
      message.method === 'Network.loadingFinished' ||
      message.method === 'Network.loadingFailed'
    ) {
      const ended = requestEndSchema.parse(message.params);
      const request = requests.get(ended.requestId);
      if (request && request.endedAt === undefined) {
        request.endedAt = request.offsetMs + ended.timestamp * 1000;
        request.failed = message.method === 'Network.loadingFailed';
      }
      return;
    }
    if (message.method !== 'Runtime.consoleAPICalled') {
      return;
    }
    const [tag, channel, ...values] = consoleSchema
      .parse(message.params)
      .args.map((arg) => arg.value);
    if (tag === measureTag && typeof channel === 'string') {
      logs.push({ channel, values });
    }
  };

  socket.addEventListener('message', (event) => {
    const message = messageSchema.parse(JSON.parse(String(event.data)));
    const waiting =
      message.id === undefined ? undefined : pending.get(message.id);
    if (message.id !== undefined && waiting) {
      pending.delete(message.id);
      if (message.error) {
        waiting.reject(new Error(message.error.message));
      } else {
        waiting.resolve(message.result);
      }
      return;
    }
    receive(message);
  });
  await watchTarget();

  return {
    evaluate,
    send,
    logs,
    requests: () =>
      [...requests.values()].map((request) => ({
        url: request.url,
        sentAt: request.sentAt,
        endedAt: request.endedAt,
        failed: request.failed,
      })),
    close: () => {
      socket.close();
    },
  };
};
