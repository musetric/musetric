import { type CqtPlan, verifyCqtPlanArtifact } from '@musetric/cqt';
import { chordNetModel } from '../models/chordNetModel.js';
import { createChordNetGpuRuntime } from '../runtime/chords/chordNetGpuRuntime.js';
import { buildChordSegments, type ChordResult } from './chordSegments.js';

type CqtPlanManifest = {
  payloadSha256: string;
};

const isCqtPlanManifest = (value: unknown): value is CqtPlanManifest => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return typeof Reflect.get(value, 'payloadSha256') === 'string';
};

const fetchOk = async (url: string, label: string): Promise<Response> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  return response;
};

export const fetchCqtPlan = async (
  planUrl: string,
  planManifestUrl: string | undefined,
): Promise<CqtPlan> => {
  const response = await fetchOk(planUrl, 'CQT plan');
  const plan = await verifyCqtPlanArtifact(
    new Uint8Array(await response.arrayBuffer()),
  );
  if (planManifestUrl !== undefined) {
    const manifest: unknown = await (
      await fetchOk(planManifestUrl, 'CQT plan manifest')
    ).json();
    if (!isCqtPlanManifest(manifest)) {
      throw new Error('CQT plan manifest has an invalid payload SHA-256');
    }
    if (manifest.payloadSha256 !== plan.payloadSha256) {
      throw new Error('CQT plan manifest payload SHA-256 does not match');
    }
  }
  return plan;
};

export type AnalyzeChordsInBrowserOptions = {
  audio: Float32Array;
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
  onProgress?: (progress: number) => void;
};

export const analyzeChordIndicesInBrowser = async (
  options: AnalyzeChordsInBrowserOptions,
): Promise<Int32Array> => {
  const { audio, modelUrl, planUrl, planManifestUrl, onProgress } = options;
  const plan = await fetchCqtPlan(planUrl, planManifestUrl);
  onProgress?.(0.3);
  const analyzeWith = async (): Promise<Int32Array> => {
    const runtime = await createChordNetGpuRuntime({ modelUrl, plan });
    try {
      onProgress?.(0.4);
      const indices = await runtime.analyze(audio);
      onProgress?.(1);
      return Int32Array.from(indices);
    } finally {
      await runtime.release();
    }
  };
  return await analyzeWith();
};

export const analyzeChordsInBrowser = async (
  options: AnalyzeChordsInBrowserOptions,
): Promise<ChordResult> => {
  const indices = await analyzeChordIndicesInBrowser(options);
  return buildChordSegments(indices, chordNetModel.frameDuration);
};
