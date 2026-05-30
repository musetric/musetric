import { createLeadBackingGpuRuntime } from '../runtime/leadBacking/leadBackingRuntime.js';
import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import { separateLeadBacking } from '../separation/separateLeadBacking.js';
import { separateVocals } from '../separation/separateVocals.js';
import { type StereoAudio } from '../separation/stereoAudio.js';
import {
  type BrowserProgressMessage,
  type BrowserSeparateAudioRequest,
  type BrowserSeparateAudioResponse,
  reportProgressApiName,
  separateAudioApiName,
} from './browserApi.js';

const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

const runVocalsStage = async (
  request: BrowserSeparateAudioRequest,
  audio: StereoAudio,
): ReturnType<typeof separateVocals> => {
  const runtime = await createVocalsGpuRuntime({
    modelUrl: request.vocalsModelUrl,
    modelDataUrl: request.vocalsModelDataUrl,
    modelDataPath: request.vocalsModelDataPath,
  });
  try {
    return await separateVocals({
      audio,
      runtime,
      onMessage: async (message) => {
        await reportProgress(message.progress / 2);
      },
    });
  } finally {
    await runtime.release();
  }
};

const runLeadBackingStage = async (
  request: BrowserSeparateAudioRequest,
  vocals: StereoAudio,
): ReturnType<typeof separateLeadBacking> => {
  const runtime = await createLeadBackingGpuRuntime({
    modelUrl: request.leadBackingModelUrl,
  });
  try {
    return await separateLeadBacking({
      audio: vocals,
      runtime,
      onMessage: async (message) => {
        await reportProgress(0.5 + message.progress / 2);
      },
    });
  } finally {
    await runtime.release();
  }
};

const createAudio = async (
  request: BrowserSeparateAudioRequest,
): Promise<StereoAudio> => {
  const response = await fetch(request.audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch AI input audio: HTTP ${response.status}`);
  }
  return {
    sampleRate: request.sampleRate,
    samples: request.samples,
    channels: 2,
    data: new Float32Array(await response.arrayBuffer()),
  };
};

const toArrayBuffer = (data: Float32Array<ArrayBuffer>): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

const uploadBuffer = async (
  data: Float32Array<ArrayBuffer>,
): Promise<string> => {
  const response = await fetch('/buffers', {
    method: 'POST',
    body: toArrayBuffer(data),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to upload AI output audio: HTTP ${response.status}`,
    );
  }
  const token: unknown = Reflect.get(await response.json(), 'token');
  if (typeof token !== 'string') {
    throw new Error('AI output upload response is missing a token');
  }
  return token;
};

Reflect.set(
  globalThis,
  separateAudioApiName,
  async (
    request: BrowserSeparateAudioRequest,
  ): Promise<BrowserSeparateAudioResponse> => {
    const sourceAudio = await createAudio(request);
    const vocalsResult = await runVocalsStage(request, sourceAudio);
    const leadBackingResult = await runLeadBackingStage(
      request,
      vocalsResult.vocals,
    );

    await reportProgress(1);

    return {
      leadToken: await uploadBuffer(leadBackingResult.lead.data),
      backingToken: await uploadBuffer(leadBackingResult.backing.data),
      instrumentalToken: await uploadBuffer(vocalsResult.instrumental.data),
    };
  },
);
