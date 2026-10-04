import { createLeadBackingGpuRuntime } from '../runtime/leadBacking/leadBackingRuntime.js';
import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import { createBrowserJobApi } from './browserJob.js';
import {
  fetchModelFiles,
  loadModel,
  type ReportLoading,
} from './browserModelLoad.js';
import { floatsFromBytes } from './browserShared.js';
import {
  type BrowserLeadBackingUnitsRequest,
  type BrowserSeparateUnitsRequest,
  type BrowserVocalsUnitsRequest,
} from './separationApi.js';

const silentUnitRms = 1e-3;

const isSilent = (input: Float32Array): boolean => {
  let energy = 0;
  for (const sample of input) {
    energy += sample * sample;
  }
  return Math.sqrt(energy / Math.max(input.length, 1)) < silentUnitRms;
};

type Stage = {
  run: (input: Float32Array<ArrayBuffer>) => Promise<Float32Array<ArrayBuffer>>;
  release: () => Promise<void>;
};

const createVocalsStage = async (
  request: BrowserVocalsUnitsRequest,
  report: ReportLoading,
): Promise<Stage> => {
  const [modelFile, modelDataFile] = await fetchModelFiles(
    [request.vocalsModelUrl, request.vocalsModelDataUrl],
    report,
  );
  const runtime = await createVocalsGpuRuntime({
    graph: request.graph,
    modelFile,
    modelDataFile,
    modelDataPath: request.vocalsModelDataPath,
  });
  return {
    run: async (input) => {
      const output = new Float32Array(input.length);
      await runtime.processChunk({ input, output });
      return output;
    },
    release: runtime.release,
  };
};

const createLeadBackingStage = async (
  request: BrowserLeadBackingUnitsRequest,
  report: ReportLoading,
): Promise<Stage> => {
  const [modelFile] = await fetchModelFiles(
    [request.leadBackingModelUrl],
    report,
  );
  const runtime = await createLeadBackingGpuRuntime({
    graph: request.graph,
    modelFile,
  });
  return {
    run: async (input) =>
      isSilent(input)
        ? new Float32Array(input.length)
        : await runtime.processChunk(input),
    release: runtime.release,
  };
};

const createStage = async (
  request: BrowserSeparateUnitsRequest,
  report: ReportLoading,
): Promise<Stage> =>
  request.stage === 'vocals'
    ? await createVocalsStage(request, report)
    : await createLeadBackingStage(request, report);

export const separateUnits = createBrowserJobApi<BrowserSeparateUnitsRequest>(
  async (request, context) => {
    const stage = await loadModel(context, async (report) =>
      createStage(request, report),
    );
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const output = await stage.run(floatsFromBytes(bytes));
          return new Uint8Array(
            output.buffer,
            output.byteOffset,
            output.byteLength,
          );
        },
      });
    } finally {
      await stage.release();
    }
  },
);
