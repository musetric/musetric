import { vocalsGraphOf } from '../runtime/modelGraphs.js';
import vocalsPin from '../runtime/vocals/pin.json' with { type: 'json' };
import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import {
  type SeparateTrackOptions,
  type SeparationModel,
} from './separateTrack.js';

const hub = 'https://huggingface.co';
const graph = vocalsGraphOf(vocalsPin.graph);

export type SeparationModelFileName = 'model' | 'modelData';

export type SeparationModelFile = {
  url: string;
  bytes: number;
  sha256: string;
};

const pinnedFile = (name: SeparationModelFileName): SeparationModelFile => {
  const file = vocalsPin.files[name];
  return {
    url: `${hub}/${vocalsPin.repository}/resolve/${vocalsPin.revision}/${file.name}`,
    bytes: file.bytes,
    sha256: file.sha256,
  };
};

export const separationModelFiles: Record<
  SeparationModelFileName,
  SeparationModelFile
> = {
  model: pinnedFile('model'),
  modelData: pinnedFile('modelData'),
};

export const separationTrack: Pick<
  SeparateTrackOptions,
  'geometry' | 'channels' | 'masks'
> = {
  geometry: {
    sampleRate: vocalsPin.sampleRate,
    chunkSamples: graph.chunkSamples,
  },
  channels: graph.channels,
  masks: graph.masks,
};

export const separationSupported = async (): Promise<boolean> => {
  if (!('gpu' in navigator)) {
    return false;
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    return false;
  }
  return (
    adapter.limits.maxStorageBuffersPerShaderStage >=
    graph.minStorageBuffersPerShaderStage
  );
};

const hexOf = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

const verifyFile = async (
  name: SeparationModelFileName,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> => {
  const pinned = separationModelFiles[name];
  if (bytes.byteLength !== pinned.bytes) {
    throw new Error(
      `The separation ${name} file has ${String(bytes.byteLength)} bytes, not ${String(pinned.bytes)}`,
    );
  }
  const sha256 = hexOf(await crypto.subtle.digest('SHA-256', bytes));
  if (sha256 !== pinned.sha256) {
    throw new Error(`The separation ${name} file does not match its pin`);
  }
};

export type SeparationModelFiles = Record<
  SeparationModelFileName,
  Uint8Array<ArrayBuffer>
>;

export const loadSeparationModel = async (
  files: SeparationModelFiles,
): Promise<SeparationModel> => {
  await verifyFile('model', files.model);
  await verifyFile('modelData', files.modelData);
  const model = await createVocalsGpuRuntime({
    graph,
    modelFile: files.model,
    modelDataFile: files.modelData,
    modelDataPath: vocalsPin.files.modelData.name,
  });
  files.model.buffer.transfer(0);
  files.modelData.buffer.transfer(0);
  return model;
};
