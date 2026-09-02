import { expect, test } from 'vitest';
import { startJobExecutor } from '../browserExecutor.js';
import {
  deliverFile,
  registerBrowserApi,
  reportProgress,
} from '../browserShared.js';
import { readSocketUrl, startFakeHost } from './jobHarness.js';

const apiName = 'musetricAiExecutorTestApi';
const stemName = 'lead.pcm';

const announceAdapter = (shaderF16: boolean): void => {
  const features = {
    has: (feature: string) => feature === 'shader-f16' && shaderF16,
  };
  Object.defineProperty(globalThis.navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => Promise.resolve({ features }) },
  });
};

test('the browser client runs a job, reports progress and uploads its file', async () => {
  announceAdapter(true);
  const stem = new Float32Array([0.5, -0.5]);
  registerBrowserApi<{ gain: number }, { frames: number }>(
    apiName,
    async (request) => {
      await reportProgress(0.5);
      await deliverFile(stemName, stem.buffer);
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
    expect(host.progress).toEqual([0.5]);
    expect(host.uploads.get(stemName)).toEqual(Buffer.from(stem.buffer));
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
