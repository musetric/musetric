import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { inject, it } from 'vitest';
import { createBrowserBundleConfig } from '../../browserBundle.vite.js';
import { type ParityCase, type ParityDevice } from './parityCases.js';
import { type ParityJob } from './parityJob.js';
import { readParityModels } from './parityModels.js';
import { openDevice, startParityServer } from './parityServer.js';
import { caseTasks } from './parityTasks.js';

type ParityRunRequest = {
  outDir: string;
  cases: ParityCase[];
  device: ParityDevice;
  port: number;
  chrome: string;
  timeoutMinutes: number;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    parityRun?: ParityRunRequest;
  }
}

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    parityRun?: number;
  }
}

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pageEntry = fileURLToPath(new URL('./parityPage.ts', import.meta.url));

it('runs the parity page on one device', async (context) => {
  const request = inject('parityRun');
  if (!request) {
    return;
  }
  const models = readParityModels();
  const job: ParityJob = {
    tasks: request.cases.flatMap((testCase) =>
      caseTasks({
        outDir: request.outDir,
        models,
        testCase,
        desktop: request.device.serial === undefined,
      }),
    ),
  };
  const pageDir = resolve(request.outDir, 'page', request.device.name);
  await build({
    ...createBrowserBundleConfig({
      root: packageRoot,
      outDir: pageDir,
      entry: pageEntry,
    }),
    configFile: false,
    logLevel: 'warn',
  });
  const server = startParityServer({
    port: request.port,
    pageDir,
    outDir: request.outDir,
    device: request.device.name,
    job,
  });
  const close = openDevice({
    device: request.device,
    port: request.port,
    url: server.url,
    chrome: request.chrome,
  });
  const timeout = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    timeout.reject(
      new Error(
        `${request.device.name} did not finish in ${request.timeoutMinutes} minutes`,
      ),
    );
  }, request.timeoutMinutes * 60_000);
  try {
    await Promise.race([server.finished, timeout.promise]);
  } finally {
    clearTimeout(timer);
    close();
    await server.close();
  }
  context.task.meta.parityRun = job.tasks.length;
});
