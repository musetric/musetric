import { expect, test } from 'vitest';
import { type JobExecutor, startJobExecutor } from '../browserExecutor.js';
import { type BrowserJobApis, createBrowserJobApi } from '../browserJob.js';
import { type FakeHost, startFakeHost } from './jobHarness.js';

const apiName = 'musetricAiExecutorTestApi';
const reconnectDelayMs = 10;

const announceAdapter = (shaderF16: boolean): void => {
  const features = {
    has: (feature: string) => feature === 'shader-f16' && shaderF16,
  };
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => Promise.resolve({ features }) },
  });
};

const settle = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

type Restarts = { count: number };

const withExecutor = async (
  apis: BrowserJobApis,
  check: (
    host: FakeHost,
    executor: JobExecutor,
    restarts: Restarts,
  ) => Promise<void>,
): Promise<void> => {
  const host = await startFakeHost();
  const restarts: Restarts = { count: 0 };
  const executor = startJobExecutor({
    jobUrl: host.socketUrl,
    apis,
    reconnectDelayMs,
    restart: () => {
      restarts.count += 1;
    },
  });
  try {
    await check(host, executor, restarts);
  } finally {
    await executor.stop();
    await host.close();
  }
};

test('the browser client runs a job and reports its phases', async () => {
  announceAdapter(true);
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<{ gain: number }>(
      async (request, context) => {
        context.reportLoading();
        return Promise.resolve({ frames: request.gain });
      },
    ),
  };

  await withExecutor(apis, async (host) => {
    expect(await host.ready).toEqual({
      type: 'ready',
      adapter: true,
      shaderF16: true,
    });
    const result = await host.run(apiName, { gain: 3 });

    expect(result).toEqual({ frames: 3 });
    expect(host.phases).toEqual([
      { type: 'loading', jobId: expect.any(String) },
    ]);
  });
});

test('the browser client forwards unit events and confirms them', async () => {
  announceAdapter(true);
  const attempt = 'attempt-9';
  const served: number[] = [];
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<{ attemptUrl: string }>(
      async (request, context) => {
        await context.serveUnits({
          attemptId: attempt,
          attemptUrl: request.attemptUrl,
          outputs: [],
          run: async (input, unit) => {
            served.push(unit);
            return Promise.resolve(input);
          },
        });
      },
    ),
  };

  await withExecutor(apis, async (host) => {
    host.windows.set(`${attempt}/2`, Buffer.alloc(4));
    await host.ready;
    const answered = host.run(apiName, {
      attemptUrl: `${host.baseUrl}/attempt/${attempt}`,
    });
    host.sendUnit(attempt, 2, 4);
    host.sendUnitClose(attempt);

    await answered;
    expect(served).toEqual([2]);
    expect(host.unitDone).toEqual([{ attemptId: attempt, unit: 2 }]);
  });
});

test('the browser client finishes the unit in flight and frees the model before it reconnects', async () => {
  announceAdapter(true);
  const attempt = 'attempt-dropped';
  const unitStarted = Promise.withResolvers<void>();
  const unitFinish = Promise.withResolvers<void>();
  const events: string[] = [];
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<{ attemptUrl: string }>(
      async (request, context) => {
        try {
          await context.serveUnits({
            attemptId: attempt,
            attemptUrl: request.attemptUrl,
            outputs: [],
            run: async (input) => {
              unitStarted.resolve();
              await unitFinish.promise;
              events.push('unit finished');
              return input;
            },
          });
        } finally {
          await settle(reconnectDelayMs * 10);
          events.push('model released');
        }
      },
    ),
  };

  await withExecutor(apis, async (host) => {
    host.windows.set(`${attempt}/0`, Buffer.alloc(4));
    await host.ready;
    void host
      .run(apiName, { attemptUrl: `${host.baseUrl}/attempt/${attempt}` })
      .catch(() => undefined);
    host.sendUnit(attempt, 0, 1);
    await unitStarted.promise;

    host.drop();
    await settle(reconnectDelayMs * 20);
    expect(events).toEqual([]);
    expect(host.readies).toHaveLength(1);

    unitFinish.resolve();
    await expect.poll(() => host.readies.length).toBe(2);
    expect(events).toEqual(['unit finished', 'model released']);
  });
});

test('the browser client refuses a job while another one is running', async () => {
  announceAdapter(true);
  const firstRunning = Promise.withResolvers<void>();
  const firstFinish = Promise.withResolvers<void>();
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<{ name: string }>(async (request) => {
      firstRunning.resolve();
      await firstFinish.promise;
      return { name: request.name };
    }),
  };

  await withExecutor(apis, async (host) => {
    await host.ready;
    const first = host.run(apiName, { name: 'first' });
    await firstRunning.promise;

    await expect(host.run(apiName, { name: 'second' })).rejects.toThrow(
      'already running a job',
    );
    firstFinish.resolve();
    expect(await first).toEqual({ name: 'first' });
  });
});

test('a second browser client waits until the first one stops', async () => {
  announceAdapter(true);

  await withExecutor({}, async (host, first) => {
    await host.ready;
    const second = startJobExecutor({
      jobUrl: host.socketUrl,
      apis: {},
      reconnectDelayMs,
      restart: () => undefined,
    });
    try {
      await settle(reconnectDelayMs * 20);
      expect(host.connections()).toBe(1);

      await first.stop();
      await expect.poll(() => host.readies.length).toBe(2);
      expect(host.connections()).toBe(1);
    } finally {
      await second.stop();
    }
  });
});

test('the browser client announces an adapter without shader-f16', async () => {
  announceAdapter(false);

  await withExecutor({}, async (host) => {
    expect(await host.ready).toEqual({
      type: 'ready',
      adapter: true,
      shaderF16: false,
    });
  });
});

test('the browser client reports a failing job back to the host', async () => {
  announceAdapter(true);
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<unknown>(() => {
      throw new Error('the runtime ran out of memory');
    }),
  };

  await withExecutor(apis, async (host, _executor, restarts) => {
    await expect(host.run(apiName, {})).rejects.toThrow(
      'the runtime ran out of memory',
    );
    await expect.poll(() => restarts.count).toBe(1);
    await settle(reconnectDelayMs * 20);
    expect(host.readies).toHaveLength(1);
  });
});

test('the browser client keeps its runtime after a job that succeeds', async () => {
  announceAdapter(true);
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<unknown>(async () => Promise.resolve(1)),
  };

  await withExecutor(apis, async (host, _executor, restarts) => {
    expect(await host.run(apiName, {})).toBe(1);
    expect(await host.run(apiName, {})).toBe(1);
    expect(restarts.count).toBe(0);
  });
});

test('the browser client rejects a job for an api it does not have', async () => {
  announceAdapter(true);

  await withExecutor({}, async (host) => {
    await expect(host.run(apiName, {})).rejects.toThrow('is not initialized');
  });
});

test('the browser client refuses a socket url outside the machine', () => {
  expect(() => {
    startJobExecutor({
      jobUrl: 'ws://example.com/jobs',
      apis: {},
      reconnectDelayMs,
      restart: () => undefined,
    });
  }).toThrow('accepts a local socket url only');
  expect(() => {
    startJobExecutor({
      jobUrl: 'http://127.0.0.1/jobs',
      apis: {},
      reconnectDelayMs,
      restart: () => undefined,
    });
  }).toThrow('accepts a local socket url only');
});

test('the browser client answers a ping so the host can see it is alive', async () => {
  announceAdapter(true);

  await withExecutor({}, async (host) => {
    await host.ready;
    host.ping();
    await expect.poll(() => host.alive, { timeout: 2000 }).toEqual(['pong']);
  });
});
