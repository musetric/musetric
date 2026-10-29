import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import { createBrowserJobApi } from './browserJob.js';
import {
  fetchModelFiles,
  loadModel,
  releaseModelFiles,
} from './browserModelLoad.js';
import { floatsFromBytes } from './browserShared.js';
import { type BrowserSeparateUnitsRequest } from './separationApi.js';

export const separateUnits = createBrowserJobApi<BrowserSeparateUnitsRequest>(
  async (request, context) => {
    const runtime = await loadModel(context, async (report) => {
      const [modelFile, modelDataFile] = await fetchModelFiles(
        [request.vocalsModelUrl, request.vocalsModelDataUrl],
        report,
      );
      const created = await createVocalsGpuRuntime({
        graph: request.graph,
        modelFile,
        modelDataFile,
        modelDataPath: request.vocalsModelDataPath,
      });
      releaseModelFiles([modelFile, modelDataFile]);
      return created;
    });
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const input = floatsFromBytes(bytes);
          const output = new Float32Array(input.length * request.graph.masks);
          await runtime.processChunk({ input, output });
          return new Uint8Array(
            output.buffer,
            output.byteOffset,
            output.byteLength,
          );
        },
      });
    } finally {
      await runtime.release();
    }
  },
);
