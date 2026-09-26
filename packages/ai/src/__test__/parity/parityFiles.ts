import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const sha256Of = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export type PinnedDownload = {
  url: string;
  sha256: string;
  target: string;
};

export const ensureDownload = async (
  download: PinnedDownload,
): Promise<void> => {
  if (
    existsSync(download.target) &&
    sha256Of(readFileSync(download.target)) === download.sha256
  ) {
    return;
  }
  console.log(`download ${download.url}`);
  const response = await fetch(download.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${download.url}: HTTP ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256Of(bytes);
  if (actual !== download.sha256) {
    throw new Error(
      `${download.url} has sha256 ${actual}, expected ${download.sha256}`,
    );
  }
  mkdirSync(dirname(download.target), { recursive: true });
  writeFileSync(download.target, bytes);
};

export type DecodeRequest = {
  path: string;
  sampleRate: number;
  channels: number;
};

export const decodePlanar = (request: DecodeRequest): Float32Array[] => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      request.path,
      '-ac',
      String(request.channels),
      '-ar',
      String(request.sampleRate),
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 2 ** 31 - 1 },
  );
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed on ${request.path}: ${result.stderr.toString()}`,
    );
  }
  const bytes = Uint8Array.from(result.stdout);
  const interleaved = new Float32Array(bytes.buffer);
  const frames = interleaved.length / request.channels;
  return Array.from({ length: request.channels }, (_, channel) =>
    Float32Array.from(
      { length: frames },
      (_value, frame) => interleaved[frame * request.channels + channel],
    ),
  );
};

export type WavRequest = {
  path: string;
  sampleRate: number;
  channels: Float32Array[];
};

export const writeWav = (request: WavRequest): void => {
  const channelCount = request.channels.length;
  const frames = request.channels[0].length;
  const dataBytes = frames * channelCount * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, request.sampleRate, true);
  view.setUint32(28, request.sampleRate * channelCount * 4, true);
  view.setUint16(32, channelCount * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      view.setFloat32(
        44 + (frame * channelCount + channel) * 4,
        request.channels[channel][frame],
        true,
      );
    }
  }
  mkdirSync(dirname(request.path), { recursive: true });
  writeFileSync(request.path, new Uint8Array(buffer));
};

export type ParityManifestTensor = {
  file: string;
  dtype: 'float32' | 'int32';
  shape: number[];
};

export type ParityManifest = {
  step: string;
  meta: Record<string, unknown>;
  tensors: Record<string, ParityManifestTensor>;
  results: Record<string, unknown>;
};

const isParityManifest = (value: unknown): value is ParityManifest => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return 'tensors' in value;
};

export const readManifestGpu = (path: string): string => {
  const rawManifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof rawManifest !== 'object' ||
    !rawManifest ||
    !('gpu' in rawManifest)
  ) {
    return '';
  }
  return String(rawManifest.gpu);
};

export const readManifest = (path: string): ParityManifest => {
  const rawManifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isParityManifest(rawManifest)) {
    throw new Error(`${path} is not a parity manifest`);
  }
  return rawManifest;
};

export const readTensorValues = (
  path: string,
  tensor: ParityManifestTensor,
): Float32Array | Int32Array => {
  const bytes = Uint8Array.from(readFileSync(path));
  return tensor.dtype === 'int32'
    ? new Int32Array(bytes.buffer)
    : new Float32Array(bytes.buffer);
};
