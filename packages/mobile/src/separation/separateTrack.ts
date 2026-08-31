import {
  createLeadBackingGpuRuntime,
  createVocalsGpuRuntime,
  separateLeadBacking,
  separateVocals,
  type StereoAudio,
} from '@musetric/ai/dom';
import { waitForGpuHeadroom } from '../app/waitForGpuHeadroom.js';
import { type ModelProgressHandler, type ModelStore } from '../models/index.js';
import {
  type MobileProjectStem,
  type MobileProjectStemId,
} from '../projects/index.js';
import { type StorageClient } from '../storage/index.js';
import { reportSeparationStage } from './separationExecutor.js';

const sampleRate = 44100;
const wavHeaderSize = 44;
const chunkSamples = 1 << 18;

export const decodeMobileStereoAudio = async (
  source: ArrayBuffer,
): Promise<StereoAudio> => {
  const decoder = new OfflineAudioContext(2, 1, sampleRate);
  const decoded = await decoder.decodeAudioData(source.slice(0));
  const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const renderer = new OfflineAudioContext(2, frameCount, sampleRate);
  const node = renderer.createBufferSource();
  node.buffer = decoded;
  node.connect(renderer.destination);
  node.start();
  const rendered = await renderer.startRendering();
  const data = new Float32Array(rendered.length * 2);
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(
    Math.min(1, rendered.numberOfChannels - 1),
  );
  data.set(left, 0);
  data.set(right, rendered.length);
  return {
    sampleRate,
    samples: rendered.length,
    channels: 2,
    data,
  };
};

const createWavHeader = (sampleCount: number): Uint8Array<ArrayBuffer> => {
  const dataLength = sampleCount * 4;
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(wavHeaderSize);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);
  return bytes;
};

const toPcm16 = (value: number): number =>
  Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));

const appendStereoWav = async (
  storage: StorageClient,
  path: string,
  audio: StereoAudio,
  onProgress: (fraction: number) => void,
): Promise<number> => {
  await storage.writeFile(path, createWavHeader(audio.samples));
  for (let start = 0; start < audio.samples; start += chunkSamples) {
    const length = Math.min(chunkSamples, audio.samples - start);
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < length; index += 1) {
      view.setInt16(index * 4, toPcm16(audio.data[start + index]), true);
      view.setInt16(
        index * 4 + 2,
        toPcm16(audio.data[audio.samples + start + index]),
        true,
      );
    }
    await storage.appendFile(path, bytes);
    onProgress((start + length) / audio.samples);
  }
  return wavHeaderSize + audio.samples * 4;
};

type SaveStemOptions = {
  storage: StorageClient;
  projectId: string;
  id: MobileProjectStemId;
  audio: StereoAudio;
  onProgress: (fraction: number) => void;
};

const saveStem = async (
  options: SaveStemOptions,
): Promise<MobileProjectStem> => {
  const { audio, id, onProgress, projectId, storage } = options;
  const path = `projects/${projectId}/stems/${id}.wav`;
  const size = await appendStereoWav(storage, path, audio, onProgress);
  return {
    id,
    path,
    contentType: 'audio/wav',
    size,
  };
};

type RunVocalsOptions = {
  audio: StereoAudio;
  model: Parameters<typeof createVocalsGpuRuntime>[0];
  onProgress: (stage: string, fraction?: number) => void;
};

const runVocals = async (
  options: RunVocalsOptions,
): Promise<Awaited<ReturnType<typeof separateVocals>>> => {
  const { audio, model, onProgress } = options;
  const runtimeLabel = 'Starting the vocal separation GPU runtime';
  onProgress(runtimeLabel, 0);
  reportSeparationStage(runtimeLabel);
  await waitForGpuHeadroom({
    activity: 'Vocal separation',
    onProgress,
  });
  const runtime = await createVocalsGpuRuntime(model);
  try {
    reportSeparationStage(`${runtimeLabel} ready`);
    return await separateVocals({
      audio,
      runtime,
      onMessage: (message) => {
        onProgress(
          'Separating vocals and instrumental on GPU',
          message.progress,
        );
      },
    });
  } finally {
    await runtime.release();
  }
};

type RunLeadBackingOptions = {
  audio: StereoAudio;
  model: Parameters<typeof createLeadBackingGpuRuntime>[0];
  onProgress: (stage: string, fraction?: number) => void;
};

const runLeadBacking = async (
  options: RunLeadBackingOptions,
): Promise<Awaited<ReturnType<typeof separateLeadBacking>>> => {
  const { audio, model, onProgress } = options;
  const runtimeLabel = 'Starting the KARA2 lead/backing GPU runtime';
  onProgress(runtimeLabel, 0.5);
  reportSeparationStage(runtimeLabel);
  await waitForGpuHeadroom({
    activity: 'KARA2 lead and backing separation',
    onProgress,
  });
  const runtime = await createLeadBackingGpuRuntime(model);
  try {
    reportSeparationStage(`${runtimeLabel} ready`);
    return await separateLeadBacking({
      audio,
      runtime,
      onMessage: (message) => {
        onProgress(
          'Separating lead and backing vocals on GPU',
          0.5 + message.progress * 0.5,
        );
      },
    });
  } finally {
    await runtime.release();
  }
};

type VocalsSeparationOptions = {
  audio: StereoAudio;
  models: ModelStore;
  onModelProgress: ModelProgressHandler;
  onProgress: (stage: string, fraction?: number) => void;
};

const separateWithVocals = async (
  options: VocalsSeparationOptions,
): Promise<{ id: MobileProjectStemId; audio: StereoAudio }[]> => {
  const { audio, models, onModelProgress, onProgress } = options;
  onProgress('Preparing the vocal separation model');
  const model = await models.ensureVocalsModel(onModelProgress);
  const result = await runVocals({
    audio,
    model,
    onProgress,
  });
  onProgress('Preparing the KARA2 lead and backing model', 0.5);
  const leadBackingModel = await models.ensureLeadBackingModel(onModelProgress);
  const leadBacking = await runLeadBacking({
    audio: result.vocals,
    model: leadBackingModel,
    onProgress,
  });
  return [
    { id: 'lead', audio: leadBacking.lead },
    { id: 'backing', audio: leadBacking.backing },
    { id: 'instrumental', audio: result.instrumental },
  ];
};

export type SeparateTrackOptions = {
  source: ArrayBuffer;
  projectId: string;
  models: ModelStore;
  storage: StorageClient;
  onModelProgress: ModelProgressHandler;
  onProgress: (stage: string, fraction?: number) => void;
};

export const separateTrack = async (
  options: SeparateTrackOptions,
): Promise<MobileProjectStem[]> => {
  const { models, onModelProgress, onProgress, projectId, source, storage } =
    options;
  reportSeparationStage('Vocal and KARA2 separation started');
  onProgress('Preparing stereo audio');
  const audio = await decodeMobileStereoAudio(source);
  const stems = await separateWithVocals({
    audio,
    models,
    onModelProgress,
    onProgress,
  });
  const saved: MobileProjectStem[] = [];
  for (const stem of stems) {
    onProgress(`Saving ${stem.id} stem`, 0);
    saved.push(
      await saveStem({
        storage,
        projectId,
        id: stem.id,
        audio: stem.audio,
        onProgress: (progress) => {
          onProgress(`Saving ${stem.id} stem`, progress);
        },
      }),
    );
    onProgress(`Saved ${stem.id} stem`, 1);
  }
  return saved;
};
