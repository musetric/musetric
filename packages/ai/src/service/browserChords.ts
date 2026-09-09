import { type CqtPlan, verifyCqtPlanArtifact } from '@musetric/cqt';
import { buildChordSegments } from '../chords/chordSegments.js';
import {
  fetchOk,
  floatsFromBytes,
  jsonBytes,
  registerBrowserApi,
  reportLoading,
} from './browserShared.js';
import { serveUnits } from './browserUnitServing.js';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
} from './chordsApi.js';

type CqtPlanManifest = {
  payloadSha256: string;
};

const isCqtPlanManifest = (value: unknown): value is CqtPlanManifest => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return typeof Reflect.get(value, 'payloadSha256') === 'string';
};

const fetchPlanManifest = async (
  planManifestUrl: string,
): Promise<CqtPlanManifest> => {
  const response = await fetchOk(planManifestUrl, 'CQT plan manifest');
  const manifest: unknown = await response.json();
  if (!isCqtPlanManifest(manifest)) {
    throw new Error('CQT plan manifest has an invalid payload SHA-256');
  }
  return manifest;
};

const fetchCqtPlan = async (
  planUrl: string,
  planManifestUrl: string | undefined,
): Promise<CqtPlan> => {
  const response = await fetchOk(planUrl, 'CQT plan');
  const plan = await verifyCqtPlanArtifact(
    new Uint8Array(await response.arrayBuffer()),
  );
  if (planManifestUrl !== undefined) {
    const manifest = await fetchPlanManifest(planManifestUrl);
    if (manifest.payloadSha256 !== plan.payloadSha256) {
      throw new Error('CQT plan manifest payload SHA-256 does not match');
    }
  }
  return plan;
};

export const registerChordsApi = (): void => {
  registerBrowserApi<BrowserAnalyzeChordsRequest, void>(
    analyzeChordsApiName,
    async (request) => {
      await reportLoading();
      const { createChordNetGpuRuntime } =
        await import('../runtime/chords/chordNetGpuRuntime.js');
      const plan = await fetchCqtPlan(request.planUrl, request.planManifestUrl);
      const runtime = await createChordNetGpuRuntime({
        graph: request.graph,
        modelUrl: request.modelUrl,
        plan,
      });
      try {
        await serveUnits({
          attemptId: request.attemptId,
          attemptUrl: request.attemptUrl,
          outputs: request.outputs,
          run: async (bytes) => {
            const audio = floatsFromBytes(bytes);
            const indices = await runtime.analyze(audio);
            return jsonBytes(
              buildChordSegments(indices, request.graph.frameDuration),
            );
          },
        });
      } finally {
        await runtime.release();
      }
    },
  );
};
