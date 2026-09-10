import { expect, test } from 'vitest';
import { startJobExecutor } from '../browserExecutor.js';
import { type BrowserJobApis, createBrowserJobApi } from '../browserJob.js';
import { readSocketUrl, startFakeHost } from './jobHarness.js';

const apiName = 'musetricAiExecutorTestApi';

const announceAdapter = (shaderF16: boolean): void => {
  const features = {
    has: (feature: string) => feature === 'shader-f16' && shaderF16,
  };
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => Promise.resolve({ features }) },
  });
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
  const host = await startFakeHost();

  try {
    startJobExecutor({
      jobUrl: readSocketUrl(host.pageUrl),
      apis,
      foreground: undefined,
    });
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
  } finally {
    await host.close();
  }
});

test('the browser client forwards unit events and confirms them', async () => {
  announceAdapter(true);
  const attempt = 'attempt-9';
  const served: number[] = [];
  const host = await startFakeHost();
  host.windows.set(`${attempt}/2`, Buffer.alloc(4));
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<{ attemptId: string }>(
      async (request, context) => {
        await context.serveUnits({
          attemptId: request.attemptId,
          attemptUrl: `${host.pageUrl.split('/?')[0]}/attempt/${request.attemptId}`,
          outputs: [],
          run: async (input, unit) => {
            served.push(unit);
            return Promise.resolve(input);
          },
        });
      },
    ),
  };

  try {
    startJobExecutor({
      jobUrl: readSocketUrl(host.pageUrl),
      apis,
      foreground: undefined,
    });
    await host.ready;
    const answered = host.run(apiName, { attemptId: attempt });
    host.sendUnit(attempt, 2, 4);
    host.sendUnitClose(attempt);

    await answered;
    expect(served).toEqual([2]);
    expect(host.unitDone).toEqual([{ attemptId: attempt, unit: 2 }]);
  } finally {
    await host.close();
  }
});

test('the browser client announces an adapter without shader-f16', async () => {
  announceAdapter(false);
  const host = await startFakeHost();

  try {
    startJobExecutor({
      jobUrl: readSocketUrl(host.pageUrl),
      apis: {},
      foreground: undefined,
    });

    expect(await host.ready).toEqual({
      type: 'ready',
      adapter: true,
      shaderF16: false,
    });
  } finally {
    await host.close();
  }
});

test('the browser client reports a failing job back to the host', async () => {
  announceAdapter(true);
  const apis: BrowserJobApis = {
    [apiName]: createBrowserJobApi<unknown>(() => {
      throw new Error('the runtime ran out of memory');
    }),
  };
  const host = await startFakeHost();

  try {
    startJobExecutor({
      jobUrl: readSocketUrl(host.pageUrl),
      apis,
      foreground: undefined,
    });

    await expect(host.run(apiName, {})).rejects.toThrow(
      'the runtime ran out of memory',
    );
  } finally {
    await host.close();
  }
});

test('the browser client rejects a job for an api it does not have', async () => {
  announceAdapter(true);
  const host = await startFakeHost();

  try {
    startJobExecutor({
      jobUrl: readSocketUrl(host.pageUrl),
      apis: {},
      foreground: undefined,
    });

    await expect(host.run(apiName, {})).rejects.toThrow('is not initialized');
  } finally {
    await host.close();
  }
});

test('the browser client refuses a socket url outside the machine', () => {
  expect(() => {
    startJobExecutor({
      jobUrl: 'ws://example.com/jobs',
      apis: {},
      foreground: undefined,
    });
  }).toThrow('accepts a local socket url only');
  expect(() => {
    startJobExecutor({
      jobUrl: 'http://127.0.0.1/jobs',
      apis: {},
      foreground: undefined,
    });
  }).toThrow('accepts a local socket url only');
});
