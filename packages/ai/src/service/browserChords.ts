import { type CqtPlan, verifyCqtPlanArtifact } from '@musetric/cqt';
import {
  buildChordSegments,
  type ChordResult,
} from '../chords/chordSegments.js';
import { chordNetModel } from '../models/chordNetModel.js';
import {
  fetchFloat32,
  fetchOk,
  registerBrowserApi,
  reportLoading,
  reportRunning,
} from './browserShared.js';
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
  registerBrowserApi<BrowserAnalyzeChordsRequest, ChordResult>(
    analyzeChordsApiName,
    async (request) => {
      await reportLoading();
      const audio = await fetchFloat32(request.pcmUrl, 'chords PCM');

      const { createChordNetGpuRuntime } =
        await import('../runtime/chords/chordNetGpuRuntime.js');
      const plan = await fetchCqtPlan(request.planUrl, request.planManifestUrl);
      const runtime = await createChordNetGpuRuntime({
        modelUrl: request.modelUrl,
        plan,
      });
      try {
        await reportRunning({ pass: 'decode', unit: 0, unitCount: 1 });
        const indices = await runtime.analyze(audio);
        return buildChordSegments(indices, chordNetModel.frameDuration);
      } finally {
        await runtime.release();
      }
    },
  );
};
