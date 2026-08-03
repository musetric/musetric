import { createHash, type Hash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import { leadBackingModel } from '../models/leadBackingModel.js';
import { resolveVocalsModelUrl, vocalsModel } from '../models/vocalsModel.js';
import { type SeparateAudioMessage } from '../separation/separateAudio.node.js';

const partialSuffix = '.part';
const manifestSuffix = '.verified';
const downloadAttempts = 3;
const retryDelayMs = 1000;

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const updateHashFromFile = async (path: string, hash: Hash): Promise<void> => {
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
};

const hashFile = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  await updateHashFromFile(path, hash);
  return hash.digest('hex');
};

const statFile = async (path: string): Promise<Stats | undefined> => {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
};

const createManifest = (fileStat: Stats, sha256: string): string =>
  `size=${fileStat.size} mtime=${fileStat.mtimeMs} sha256=${sha256}`;

const readManifest = async (path: string): Promise<string> => {
  try {
    return await readFile(`${path}${manifestSuffix}`, 'utf8');
  } catch {
    return '';
  }
};

const getCachedFileSize = async (
  path: string,
  sha256: string,
): Promise<number | undefined> => {
  const fileStat = await statFile(path);
  if (fileStat === undefined) {
    return undefined;
  }
  const manifest = createManifest(fileStat, sha256);
  if ((await readManifest(path)) === manifest) {
    return fileStat.size;
  }
  if ((await hashFile(path)) !== sha256) {
    return undefined;
  }
  await writeFile(`${path}${manifestSuffix}`, manifest);
  return fileStat.size;
};

const waitForStreamDrain = async (
  stream: ReturnType<typeof createWriteStream>,
  streamError: Promise<never>,
): Promise<void> => {
  await Promise.race([once(stream, 'drain'), streamError]);
};

const writeStreamChunk = async (
  stream: ReturnType<typeof createWriteStream>,
  streamError: Promise<never>,
  chunk: Buffer<ArrayBufferLike>,
): Promise<void> => {
  if (!stream.write(chunk)) {
    await waitForStreamDrain(stream, streamError);
  }
};

const closeWriteStream = async (
  stream: ReturnType<typeof createWriteStream>,
  streamError: Promise<never>,
): Promise<void> => {
  stream.end();
  await Promise.race([once(stream, 'finish'), streamError]);
};

type StartedDownload = {
  body: ReadableStream<Uint8Array>;
  resumeFrom: number;
  total: number | undefined;
};

const startDownload = async (
  label: string,
  url: string,
  partialSize: number,
): Promise<StartedDownload> => {
  const response = await fetch(
    url,
    partialSize > 0 ? { headers: { range: `bytes=${partialSize}-` } } : {},
  );
  if (!response.ok) {
    throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`Failed to download ${label}: empty response body`);
  }
  const resumeFrom = response.status === 206 ? partialSize : 0;
  const remaining = Number(response.headers.get('content-length') ?? 0);
  return {
    body: response.body,
    resumeFrom,
    total: remaining > 0 ? resumeFrom + remaining : undefined,
  };
};

export type ModelDownloadMessage = {
  type: 'download';
  label: string;
  file?: string;
  downloaded: number;
  total?: number;
  status?: 'processing' | 'cached' | 'done';
};

export type ModelFileOptions = {
  label: string;
  file: string;
  url: string;
  sha256: string;
  path: string;
  onDownload: (message: ModelDownloadMessage) => Promise<void>;
};

const runDownload = async (
  options: ModelFileOptions,
  partialPath: string,
): Promise<void> => {
  const { label, file, url, sha256, onDownload } = options;
  const partialStat = await statFile(partialPath);
  const { body, resumeFrom, total } = await startDownload(
    label,
    url,
    partialStat?.size ?? 0,
  );

  const hash = createHash('sha256');
  if (resumeFrom > 0) {
    await updateHashFromFile(partialPath, hash);
  }

  let downloaded = resumeFrom;
  const reader = body.getReader();
  const target = createWriteStream(partialPath, {
    flags: resumeFrom > 0 ? 'a' : 'w',
  });
  const streamError = new Promise<never>((_resolve, reject) => {
    target.on('error', reject);
  });

  await onDownload({
    type: 'download',
    label,
    file,
    downloaded,
    total,
    status: 'processing',
  });

  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      const chunk = Buffer.from(read.value);
      hash.update(chunk);
      await writeStreamChunk(target, streamError, chunk);
      downloaded += chunk.byteLength;
      await onDownload({
        type: 'download',
        label,
        file,
        downloaded,
        total,
        status:
          total !== undefined && downloaded >= total ? 'done' : 'processing',
      });
    }
  } finally {
    await closeWriteStream(target, streamError);
  }

  const downloadedHash = hash.digest('hex');
  if (downloadedHash !== sha256) {
    await rm(partialPath, { force: true });
    throw new Error(
      `Downloaded ${label} checksum mismatch: expected ${sha256}, got ${downloadedHash}`,
    );
  }
};

export const ensureCachedModelFile = async (
  options: ModelFileOptions,
): Promise<string> => {
  const { label, file, path, sha256, onDownload } = options;
  const cachedSize = await getCachedFileSize(path, sha256);
  if (cachedSize !== undefined) {
    await onDownload({
      type: 'download',
      label,
      file,
      downloaded: cachedSize,
      total: cachedSize,
      status: 'cached',
    });
    return path;
  }
  await rm(path, { force: true });
  await rm(`${path}${manifestSuffix}`, { force: true });

  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}${partialSuffix}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await runDownload(options, partialPath);
      break;
    } catch (error) {
      if (attempt === downloadAttempts) {
        throw error;
      }
      await delay(retryDelayMs * attempt);
    }
  }

  await rename(partialPath, path);
  const fileStat = await stat(path);
  await writeFile(`${path}${manifestSuffix}`, createManifest(fileStat, sha256));
  await onDownload({
    type: 'download',
    label,
    file,
    downloaded: fileStat.size,
    total: fileStat.size,
    status: 'done',
  });

  return path;
};

export type SeparationModelFiles = {
  vocalsModelPath: string;
  vocalsModelDataPath: string;
  leadBackingModelPath: string;
};

type EnsureSeparationModelFilesOptions = {
  modelsPath: string;
  handlers: MessageHandlers<SeparateAudioMessage>;
};

export const ensureSeparationModelFiles = async (
  options: EnsureSeparationModelFilesOptions,
): Promise<SeparationModelFiles> => {
  const { modelsPath, handlers } = options;
  const onDownload = async (message: ModelDownloadMessage): Promise<void> => {
    await handlers.download(message);
  };
  const vocalsDir = join(modelsPath, 'vocal-separation-roformer-onnx');
  const vocalsModelPath = await ensureCachedModelFile({
    label: 'Vocals separation model',
    file: vocalsModel.files.model,
    url: resolveVocalsModelUrl(vocalsModel.files.model),
    sha256: vocalsModel.sha256.model,
    path: join(vocalsDir, vocalsModel.files.model),
    onDownload,
  });
  const vocalsModelDataPath = await ensureCachedModelFile({
    label: 'Vocals separation model data',
    file: vocalsModel.files.data,
    url: resolveVocalsModelUrl(vocalsModel.files.data),
    sha256: vocalsModel.sha256.data,
    path: join(vocalsDir, vocalsModel.files.data),
    onDownload,
  });
  const leadBackingModelPath = await ensureCachedModelFile({
    label: 'Lead/backing separation model',
    file: leadBackingModel.file,
    url: leadBackingModel.sourceUrl,
    sha256: leadBackingModel.sha256,
    path: join(modelsPath, leadBackingModel.relativePath),
    onDownload,
  });

  return {
    vocalsModelPath,
    vocalsModelDataPath,
    leadBackingModelPath,
  };
};
