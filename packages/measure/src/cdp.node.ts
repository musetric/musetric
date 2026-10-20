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

export type CdpPage = {
  evaluate: (expression: string) => Promise<unknown>;
  logs: MeasureLog[];
  close: () => void;
};

export const connectPage = async (url: string): Promise<CdpPage> => {
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

  const watchTarget = async (sessionId?: string) => {
    await send('Runtime.enable', {}, sessionId);
    await send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
  };

  const receive = (message: CdpMessage) => {
    if (message.method === 'Target.attachedToTarget') {
      const attached = attachedSchema.parse(message.params);
      void watchTarget(attached.sessionId);
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
    evaluate: async (expression) => {
      const evaluation = evaluationSchema.parse(
        await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        }),
      );
      if (evaluation.exceptionDetails) {
        const { exception, text } = evaluation.exceptionDetails;
        throw new Error(exception?.description ?? text);
      }
      return evaluation.result.value;
    },
    logs,
    close: () => {
      socket.close();
    },
  };
};
