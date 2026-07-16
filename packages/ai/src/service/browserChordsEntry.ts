import { type CqtPlan, verifyCqtPlanArtifact } from '@musetric/cqt';
import { createChordNetGpuRuntime } from '../runtime/chords/chordNetGpuRuntime.js';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
  type BrowserAnalyzeChordsResult,
  releaseChordsApiName,
} from './chordsApi.js';

type BrowserChordRuntime = {
  modelUrl: string;
  planUrl: string;
  runtime: Awaited<ReturnType<typeof createChordNetGpuRuntime>>;
};

let browserChordRuntime: BrowserChordRuntime | undefined = undefined;

const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

const fetchMonoPcm = async (
  pcmUrl: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetch(pcmUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch chords PCM: HTTP ${response.status}`);
  }
  return new Float32Array(await response.arrayBuffer());
};

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
  const response = await fetch(planManifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch CQT plan manifest: HTTP ${response.status}`,
    );
  }
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
  const response = await fetch(planUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch CQT plan: HTTP ${response.status}`);
  }
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

const getChordRuntime = async (
  request: Pick<
    BrowserAnalyzeChordsRequest,
    'modelUrl' | 'planUrl' | 'planManifestUrl'
  >,
): Promise<BrowserChordRuntime['runtime']> => {
  const { modelUrl, planUrl, planManifestUrl } = request;
  if (
    browserChordRuntime?.modelUrl === modelUrl &&
    browserChordRuntime.planUrl === planUrl
  ) {
    return browserChordRuntime.runtime;
  }
  if (browserChordRuntime !== undefined) {
    await browserChordRuntime.runtime.release();
    browserChordRuntime = undefined;
  }
  const plan = await fetchCqtPlan(planUrl, planManifestUrl);
  const runtime = await createChordNetGpuRuntime({ modelUrl, plan });
  browserChordRuntime = { modelUrl, planUrl, runtime };
  return runtime;
};

const releaseChordRuntime = async (): Promise<void> => {
  if (browserChordRuntime !== undefined) {
    await browserChordRuntime.runtime.release();
    browserChordRuntime = undefined;
  }
};

Reflect.set(
  globalThis,
  analyzeChordsApiName,
  async (
    request: BrowserAnalyzeChordsRequest,
  ): Promise<BrowserAnalyzeChordsResult> => {
    await reportProgress(0);
    const audio = await fetchMonoPcm(request.pcmUrl);
    await reportProgress(0.1);

    const runtime = await getChordRuntime(request);
    await reportProgress(0.4);
    const indices = await runtime.analyze(audio);
    await reportProgress(1);
    return Array.from(indices);
  },
);

Reflect.set(globalThis, releaseChordsApiName, releaseChordRuntime);
