import {
  type BrowserLeadBackingUnitsRequest,
  type BrowserSeparateUnitsRequest,
  type BrowserVocalsUnitsRequest,
  separateUnitsApiName,
} from './browserApi.js';
import {
  floatsFromBytes,
  registerBrowserApi,
  reportLoading,
} from './browserShared.js';
import { serveUnits } from './browserUnitServing.js';

type Stage = {
  run: (input: Float32Array<ArrayBuffer>) => Promise<Float32Array<ArrayBuffer>>;
  release: () => Promise<void>;
};

const createVocalsStage = async (
  request: BrowserVocalsUnitsRequest,
): Promise<Stage> => {
  const { createVocalsGpuRuntime } =
    await import('../runtime/vocals/vocalsRuntime.js');
  const runtime = await createVocalsGpuRuntime({
    graph: request.graph,
    modelUrl: request.vocalsModelUrl,
    modelDataUrl: request.vocalsModelDataUrl,
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
): Promise<Stage> => {
  const { createLeadBackingGpuRuntime } =
    await import('../runtime/leadBacking/leadBackingRuntime.js');
  const runtime = await createLeadBackingGpuRuntime({
    graph: request.graph,
    modelUrl: request.leadBackingModelUrl,
  });
  return {
    run: async (input) => await runtime.processChunk(input),
    release: runtime.release,
  };
};

const createStage = async (
  request: BrowserSeparateUnitsRequest,
): Promise<Stage> =>
  request.stage === 'vocals'
    ? await createVocalsStage(request)
    : await createLeadBackingStage(request);

export const registerSeparationApi = (): void => {
  registerBrowserApi<BrowserSeparateUnitsRequest, void>(
    separateUnitsApiName,
    async (request) => {
      await reportLoading();
      const stage = await createStage(request);
      try {
        await serveUnits({
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
};
