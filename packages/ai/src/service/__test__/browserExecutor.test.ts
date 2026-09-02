import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { startJobExecutor } from '../browserExecutor.js';
import {
  deliverFile,
  registerBrowserApi,
  reportProgress,
} from '../browserShared.js';
import { createJobGpuPage } from '../jobGpuPage.node.js';
import { createWorkspace, openWith } from './jobHarness.js';

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
  const workspace = createWorkspace();
  const reported: number[] = [];
  const stem = new Float32Array([0.5, -0.5]);
  registerBrowserApi<{ gain: number }, { frames: number }>(
    apiName,
    async (request) => {
      await reportProgress(0.5);
      await deliverFile(stemName, stem.buffer);
      return { frames: request.gain };
    },
  );

  const page = await createJobGpuPage({
    label: 'Executor round trip',
    pageUrl: 'http://127.0.0.1:1/',
    apiName,
    requireShaderF16: true,
    onProgress: (progress) => {
      reported.push(progress);
    },
    open: openWith(startJobExecutor),
  });

  try {
    const target = workspace.path(stemName);
    const saved = page.captureDownloads(new Map([[stemName, target]]));
    const result = await page.evaluate<{ frames: number }>({ gain: 3 });
    await saved;
    expect(result).toEqual({ frames: 3 });
    expect(reported).toEqual([0.5]);
    expect(readFileSync(target)).toEqual(Buffer.from(stem.buffer));
  } finally {
    await page.close();
    workspace.remove();
  }
});

test('the browser client reports a failing job back to the host', async () => {
  announceAdapter(true);
  registerBrowserApi<unknown, never>(apiName, () => {
    throw new Error('the runtime ran out of memory');
  });

  const page = await createJobGpuPage({
    label: 'Executor failure',
    pageUrl: 'http://127.0.0.1:1/',
    apiName,
    requireShaderF16: false,
    open: openWith(startJobExecutor),
  });

  try {
    await expect(page.evaluate({})).rejects.toThrow(
      'the runtime ran out of memory',
    );
  } finally {
    await page.close();
  }
});
