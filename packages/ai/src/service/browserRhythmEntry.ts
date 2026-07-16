import { createBeatThisGpuRuntime } from '../runtime/rhythm/beatThisGpuRuntime.js';
import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
  type BrowserAnalyzeRhythmResult,
  releaseRhythmApiName,
} from './rhythmApi.js';

type BrowserRhythmRuntime = {
  modelUrl: string;
  filterbankUrl: string;
  runtime: Awaited<ReturnType<typeof createBeatThisGpuRuntime>>;
};

let browserRhythmRuntime: BrowserRhythmRuntime | undefined = undefined;

const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

const fetchFloat32 = async (
  url: string,
  label: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch rhythm ${label}: HTTP ${response.status}`);
  }
  return new Float32Array(await response.arrayBuffer());
};

const getRhythmRuntime = async (
  request: Pick<BrowserAnalyzeRhythmRequest, 'modelUrl' | 'filterbankUrl'>,
): Promise<BrowserRhythmRuntime['runtime']> => {
  const { modelUrl, filterbankUrl } = request;
  if (
    browserRhythmRuntime?.modelUrl === modelUrl &&
    browserRhythmRuntime.filterbankUrl === filterbankUrl
  ) {
    return browserRhythmRuntime.runtime;
  }
  if (browserRhythmRuntime !== undefined) {
    await browserRhythmRuntime.runtime.release();
    browserRhythmRuntime = undefined;
  }
  const filterbank = await fetchFloat32(filterbankUrl, 'mel filterbank');
  const runtime = await createBeatThisGpuRuntime({ modelUrl, filterbank });
  browserRhythmRuntime = { modelUrl, filterbankUrl, runtime };
  return runtime;
};

const releaseRhythmRuntime = async (): Promise<void> => {
  if (browserRhythmRuntime !== undefined) {
    await browserRhythmRuntime.runtime.release();
    browserRhythmRuntime = undefined;
  }
};

Reflect.set(
  globalThis,
  analyzeRhythmApiName,
  async (
    request: BrowserAnalyzeRhythmRequest,
  ): Promise<BrowserAnalyzeRhythmResult> => {
    await reportProgress(0);
    const audio = await fetchFloat32(request.pcmUrl, 'PCM');
    await reportProgress(0.1);

    const runtime = await getRhythmRuntime(request);
    const logits = await runtime.analyze(audio, async (progress) => {
      await reportProgress(0.1 + progress * 0.8);
    });
    await reportProgress(1);
    return {
      beat: Array.from(logits.beat),
      downbeat: Array.from(logits.downbeat),
    };
  },
);

Reflect.set(globalThis, releaseRhythmApiName, releaseRhythmRuntime);
