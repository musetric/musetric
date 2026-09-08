import { expect, test } from 'vitest';
import { startJobExecutor } from '../browserExecutor.js';
import { registerBrowserApi, reportLoading } from '../browserShared.js';
import { registerUnitReceiver } from '../browserUnitServing.js';
import {
  type UnitCloseCommand,
  type UnitCommand,
  unitDoneApiName,
} from '../jobProtocol.js';
import { readSocketUrl, startFakeHost } from './jobHarness.js';

const apiName = 'musetricAiExecutorTestApi';

const announceAdapter = (shaderF16: boolean): void => {
  const features = {
    has: (feature: string) => feature === 'shader-f16' && shaderF16,
  };
  Object.defineProperty(globalThis.navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => Promise.resolve({ features }) },
  });
};

test('the browser client runs a job and reports its phases', async () => {
  announceAdapter(true);
  registerBrowserApi<{ gain: number }, { frames: number }>(
    apiName,
    async (request) => {
      await reportLoading();
      return { frames: request.gain };
    },
  );
  const host = await startFakeHost();

  try {
    startJobExecutor(readSocketUrl(host.pageUrl));
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
  const received: (UnitCommand | UnitCloseCommand)[] = [];
  registerBrowserApi<unknown, void>(apiName, async () => {
    const closed = Promise.withResolvers<void>();
    registerUnitReceiver(async (event) => {
      received.push(event);
      if (event.type === 'unit') {
        const done: unknown = Reflect.get(globalThis, unitDoneApiName);
        if (typeof done !== 'function') {
          throw new Error('AI unit done API is not initialized');
        }
        await Reflect.apply(done, undefined, [event.attemptId, event.unit]);
      }
      if (event.type === 'unitClose') {
        closed.resolve();
      }
    });
    try {
      await closed.promise;
    } finally {
      registerUnitReceiver(undefined);
    }
  });
  const host = await startFakeHost();

  try {
    startJobExecutor(readSocketUrl(host.pageUrl));
    await host.ready;
    const answered = host.run(apiName, {});
    host.sendUnit('attempt-9', 2, 4);
    host.sendUnitClose('attempt-9');

    await answered;
    expect(received).toEqual([
      {
        type: 'unit',
        jobId: 'unit-pump',
        attemptId: 'attempt-9',
        unit: 2,
        unitCount: 4,
      },
      { type: 'unitClose', jobId: 'unit-pump', attemptId: 'attempt-9' },
    ]);
    expect(host.unitDone).toEqual([{ attemptId: 'attempt-9', unit: 2 }]);
  } finally {
    await host.close();
  }
});

test('the browser client announces an adapter without shader-f16', async () => {
  announceAdapter(false);
  const host = await startFakeHost();

  try {
    startJobExecutor(readSocketUrl(host.pageUrl));

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
  registerBrowserApi<unknown, never>(apiName, () => {
    throw new Error('the runtime ran out of memory');
  });
  const host = await startFakeHost();

  try {
    startJobExecutor(readSocketUrl(host.pageUrl));

    await expect(host.run(apiName, {})).rejects.toThrow(
      'the runtime ran out of memory',
    );
  } finally {
    await host.close();
  }
});

test('the browser client refuses a socket url outside the machine', () => {
  expect(() => {
    startJobExecutor('ws://example.com/jobs');
  }).toThrow('accepts a local socket url only');
  expect(() => {
    startJobExecutor('http://127.0.0.1/jobs');
  }).toThrow('accepts a local socket url only');
});
