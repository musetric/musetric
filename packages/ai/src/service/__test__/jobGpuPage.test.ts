import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  type CreateGpuPageOptions,
  type GpuPage,
} from '../gpuPageHost.node.js';
import { createJobGpuPage } from '../jobGpuPage.node.js';
import { type ExecutorMessage, readJobCommand } from '../jobProtocol.js';
import { createWorkspace, openWith } from './jobHarness.js';

const apiName = 'musetricAiTestApi';

type ExecutorBehaviour = {
  adapter?: boolean;
  shaderF16?: boolean;
  onJob?: (socket: WebSocket, jobId: string, uploadUrl: string) => void;
};

const connectExecutor = (
  jobUrl: string,
  behaviour: ExecutorBehaviour,
): void => {
  const socket = new WebSocket(jobUrl);
  const send = (message: ExecutorMessage): void => {
    socket.send(JSON.stringify(message));
  };
  socket.addEventListener('open', () => {
    send({
      type: 'ready',
      adapter: behaviour.adapter ?? true,
      shaderF16: behaviour.shaderF16 ?? true,
    });
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return;
    }
    const command = readJobCommand(event.data);
    if (command) {
      behaviour.onJob?.(socket, command.jobId, command.uploadUrl);
    }
  });
};

const finish = (socket: WebSocket, jobId: string, result: unknown): void => {
  socket.send(JSON.stringify({ type: 'result', jobId, result }));
};

const startHost = async (
  behaviour: ExecutorBehaviour,
  options: Partial<CreateGpuPageOptions> = {},
): Promise<GpuPage> =>
  createJobGpuPage({
    label: 'Test executor',
    pageUrl: 'http://127.0.0.1:1/',
    apiName,
    requireShaderF16: false,
    open: openWith((jobUrl) => {
      connectExecutor(jobUrl, behaviour);
    }),
    ...options,
  });

test('a job answers with the result the executor reports', async () => {
  const page = await startHost({
    onJob: (socket, jobId) => {
      finish(socket, jobId, { frames: 7 });
    },
  });
  try {
    const result = await page.evaluate<{ frames: number }>({ input: 'pcm' });
    expect(result).toEqual({ frames: 7 });
  } finally {
    await page.close();
  }
});

test('progress reaches the host while a job runs', async () => {
  const reported: number[] = [];
  const page = await startHost(
    {
      onJob: (socket, jobId) => {
        socket.send(JSON.stringify({ type: 'progress', jobId, progress: 0.5 }));
        finish(socket, jobId, 0);
      },
    },
    {
      onProgress: (progress) => {
        reported.push(progress);
      },
    },
  );
  try {
    await page.evaluate({});
    expect(reported).toEqual([0.5]);
  } finally {
    await page.close();
  }
});

test('an uploaded file lands at the captured target', async () => {
  const workspace = createWorkspace();
  const payload = new Uint8Array([1, 2, 3, 4]);
  const page = await startHost({
    onJob: (socket, jobId, uploadUrl) => {
      void fetch(`${uploadUrl}lead.pcm`, {
        method: 'PUT',
        body: payload,
      }).then(() => {
        finish(socket, jobId, 0);
      });
    },
  });
  try {
    const target = workspace.path('lead.pcm');
    const saved = page.captureDownloads(new Map([['lead.pcm', target]]));
    await page.evaluate({});
    await saved;
    expect(readFileSync(target)).toEqual(Buffer.from(payload));
  } finally {
    await page.close();
    workspace.remove();
  }
});

test('a failed job rejects with the reported error', async () => {
  const page = await startHost({
    onJob: (socket, jobId) => {
      socket.send(
        JSON.stringify({ type: 'failed', jobId, error: 'the model is broken' }),
      );
    },
  });
  try {
    await expect(page.evaluate({})).rejects.toThrow('the model is broken');
  } finally {
    await page.close();
  }
});

test('an executor without the required feature is refused', async () => {
  await expect(
    startHost({ shaderF16: false }, { requireShaderF16: true }),
  ).rejects.toThrow('adapter does not support required shader-f16');
});

test('an executor without an adapter is refused', async () => {
  await expect(startHost({ adapter: false })).rejects.toThrow(
    'could not get a WebGPU adapter',
  );
});

test('an unexpected upload fails the captured downloads', async () => {
  const workspace = createWorkspace();
  const page = await startHost({
    onJob: (socket, jobId, uploadUrl) => {
      void fetch(`${uploadUrl}surprise.pcm`, {
        method: 'PUT',
        body: new Uint8Array([9]),
      }).then(() => {
        finish(socket, jobId, 0);
      });
    },
  });
  try {
    const saved = page.captureDownloads(
      new Map([['lead.pcm', workspace.path('lead.pcm')]]),
    );
    const refused = expect(saved).rejects.toThrow('Unexpected executor upload');
    await page.evaluate({});
    await refused;
  } finally {
    await page.close();
    workspace.remove();
  }
});
