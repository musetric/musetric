import { type CqtPlan, verifyCqtPlanArtifact } from '@musetric/cqt';
import {
  fetchFloat32,
  fetchOk,
  registerBrowserApi,
  reportProgress,
} from './browserShared.js';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
  type BrowserAnalyzeChordsResult,
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
  registerBrowserApi<BrowserAnalyzeChordsRequest, BrowserAnalyzeChordsResult>(
    analyzeChordsApiName,
    async (request) => {
      await reportProgress(0);
      const audio = await fetchFloat32(request.pcmUrl, 'chords PCM');
      await reportProgress(0.1);

      const { createChordNetGpuRuntime } =
        await import('../runtime/chords/chordNetGpuRuntime.js');
      const plan = await fetchCqtPlan(request.planUrl, request.planManifestUrl);
      const runtime = await createChordNetGpuRuntime({
        modelUrl: request.modelUrl,
        plan,
      });
      try {
        await reportProgress(0.4);
        const indices = await runtime.analyze(audio);
        await reportProgress(1);
        return Array.from(indices);
      } finally {
        await runtime.release();
      }
    },
  );
};
