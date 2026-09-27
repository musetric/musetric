import * as ort from 'onnxruntime-web/webgpu';
import { serveOrtWasmFromBundle } from '../../runtime/ortWasm.js';
import { musetricWebGpuProvider } from '../../runtime/webgpuDevice.js';
import { runChordsTask, runKeyTask, runRhythmTask } from './parityAnalysis.js';
import {
  fetchTensor,
  outputQuery,
  type ParityJob,
  type ParityModelOutput,
  type ParityModelTask,
  type ParityOutput,
  type ParityTask,
} from './parityJob.js';
import { runVocalsTask, runVoicesTask } from './paritySeparation.js';

const runId = new URLSearchParams(location.search).get('run') ?? '';

const postText = async (path: string, text: string): Promise<void> => {
  await fetch(`${path}?${new URLSearchParams({ run: runId }).toString()}`, {
    method: 'POST',
    body: text,
  });
};

const postOutput = async (
  caseName: string,
  output: ParityOutput,
): Promise<void> => {
  const query = outputQuery({ run: runId, caseName, output });
  const response = await fetch(`/output?${query}`, {
    method: 'POST',
    body: Uint8Array.from(
      new Uint8Array(
        output.values.buffer,
        output.values.byteOffset,
        output.values.byteLength,
      ),
    ),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to post ${output.boundary}: HTTP ${response.status}`,
    );
  }
};

const executionProviders = async (
  task: ParityModelTask,
): Promise<ort.InferenceSession.ExecutionProviderConfig[]> =>
  task.provider === 'wasm'
    ? ['wasm']
    : [
        await musetricWebGpuProvider(
          task.simpleBufferCache ? { storageBufferCacheMode: 'simple' } : {},
        ),
      ];

const createInput = async (
  input: ParityModelTask['inputs'][number],
): Promise<ort.Tensor> => {
  const values = await fetchTensor(input.tensor);
  return values instanceof Int32Array
    ? new ort.Tensor('int32', values, input.tensor.shape)
    : new ort.Tensor('float32', values, input.tensor.shape);
};

const toOutput = (
  tensor: ort.Tensor,
  output: ParityModelOutput,
  source: string,
): ParityOutput => {
  const shape = [...tensor.dims];
  if (tensor.data instanceof Float32Array) {
    return {
      boundary: output.boundary,
      source,
      dtype: 'float32',
      shape,
      values: tensor.data,
    };
  }
  if (tensor.data instanceof Int32Array) {
    return {
      boundary: output.boundary,
      source,
      dtype: 'int32',
      shape,
      values: tensor.data,
    };
  }
  throw new Error(`${output.name} holds ${tensor.type}, not float32 or int32`);
};

const runModelTask = async (task: ParityModelTask): Promise<ParityOutput[]> => {
  const session = await ort.InferenceSession.create(task.modelUrl, {
    executionProviders: await executionProviders(task),
    graphOptimizationLevel: 'all',
    externalData: task.externalData,
  });
  try {
    const feeds: Record<string, ort.Tensor> = {};
    for (const input of task.inputs) {
      feeds[input.name] = await createInput(input);
    }
    const results = await session.run(feeds);
    return task.outputs.map((output) =>
      toOutput(results[output.name], output, task.provider),
    );
  } finally {
    await session.release();
  }
};

const runTask = async (task: ParityTask): Promise<ParityOutput[]> => {
  if (task.kind === 'model') {
    return await runModelTask(task);
  }
  if (task.kind === 'vocals') {
    return await runVocalsTask(task);
  }
  if (task.kind === 'voices') {
    return await runVoicesTask(task);
  }
  if (task.kind === 'rhythm') {
    return await runRhythmTask(task);
  }
  if (task.kind === 'key') {
    return await runKeyTask(task);
  }
  return await runChordsTask(task);
};

const isParityJob = (value: unknown): value is ParityJob => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return 'tasks' in value && Array.isArray(value.tasks);
};

const readJob = async (): Promise<ParityJob | undefined> => {
  const response = await fetch(
    `/job.json?${new URLSearchParams({ run: runId }).toString()}`,
  );
  if (!response.ok) {
    return undefined;
  }
  const rawJob: unknown = await response.json();
  if (!isParityJob(rawJob)) {
    throw new Error('The parity job is malformed');
  }
  return rawJob;
};

const describeGpu = async (): Promise<string> => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  const info = adapter?.info;
  const name = [info?.vendor, info?.architecture, info?.description]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  return `${name} | ${navigator.userAgent}`;
};

const run = async (): Promise<void> => {
  serveOrtWasmFromBundle();
  const job = await readJob();
  if (!job) {
    return;
  }
  await postText('/gpu', await describeGpu());
  for (const [index, task] of job.tasks.entries()) {
    const started = performance.now();
    await postText(
      '/log',
      `task ${index + 1}/${job.tasks.length}: ${task.kind} ${task.caseName}`,
    );
    const outputs = await runTask(task);
    for (const output of outputs) {
      await postOutput(task.caseName, output);
    }
    await postText(
      '/log',
      `task ${index + 1} done in ${Math.round(performance.now() - started)} ms`,
    );
  }
  await postText('/done', 'done');
};

void run().catch(async (error: unknown) => {
  await postText(
    '/fail',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
});
