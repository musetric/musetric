import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import { leadBackingModel } from '../models/leadBackingModel.js';
import { resolveVocalsModelUrl, vocalsModel } from '../models/vocalsModel.js';
import { type SeparateAudioMessage } from '../separation/separateAudio.node.js';

// Checksums are verified once per process; later runs trust the cached file
// instead of re-reading hundreds of megabytes on every separation.
const verifiedPaths = new Set<string>();

const hashFile = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
};

const getFileSize = async (path: string): Promise<number | undefined> => {
  try {
    const fileStat = await stat(path);
    return fileStat.size;
  } catch {
    return undefined;
  }
};

const sendDownloadMessage = async (
  handlers: MessageHandlers<SeparateAudioMessage>,
  message: Extract<SeparateAudioMessage, { type: 'download' }>,
): Promise<void> => {
  await handlers.download(message);
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

type ModelFileOptions = {
  label: string;
  file: string;
  url: string;
  sha256: string;
  path: string;
  handlers: MessageHandlers<SeparateAudioMessage>;
};

const ensureCachedModelFile = async (
  options: ModelFileOptions,
): Promise<string> => {
  const { label, file, path, sha256, handlers } = options;
  const existingSize = await getFileSize(path);
  if (existingSize !== undefined) {
    if (verifiedPaths.has(path) || (await hashFile(path)) === sha256) {
      verifiedPaths.add(path);
      await sendDownloadMessage(handlers, {
        type: 'download',
        label,
        file,
        downloaded: existingSize,
        total: existingSize,
        status: 'cached',
      });
      return path;
    }
    await rm(path, { force: true });
  }

  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await rm(tempPath, { force: true });

  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`Failed to download ${label}: empty response body`);
  }

  const totalValue = Number(response.headers.get('content-length') ?? 0);
  const total = totalValue > 0 ? totalValue : undefined;
  let downloaded = 0;
  const hash = createHash('sha256');
  const reader = response.body.getReader();
  const target = createWriteStream(tempPath);
  const streamError = new Promise<never>((_resolve, reject) => {
    target.on('error', reject);
  });

  await sendDownloadMessage(handlers, {
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
      await sendDownloadMessage(handlers, {
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
    await rm(tempPath, { force: true });
    throw new Error(
      `Downloaded ${label} checksum mismatch: expected ${sha256}, got ${downloadedHash}`,
    );
  }

  await rename(tempPath, path);
  verifiedPaths.add(path);
  await sendDownloadMessage(handlers, {
    type: 'download',
    label,
    file,
    downloaded,
    total: downloaded,
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
  const vocalsDir = join(modelsPath, 'vocal-separation-roformer-onnx');
  const vocalsModelPath = await ensureCachedModelFile({
    label: 'Vocals separation model',
    file: vocalsModel.files.model,
    url: resolveVocalsModelUrl(vocalsModel.files.model),
    sha256: vocalsModel.sha256.model,
    path: join(vocalsDir, vocalsModel.files.model),
    handlers,
  });
  const vocalsModelDataPath = await ensureCachedModelFile({
    label: 'Vocals separation model data',
    file: vocalsModel.files.data,
    url: resolveVocalsModelUrl(vocalsModel.files.data),
    sha256: vocalsModel.sha256.data,
    path: join(vocalsDir, vocalsModel.files.data),
    handlers,
  });
  const leadBackingModelPath = await ensureCachedModelFile({
    label: 'Lead/backing separation model',
    file: leadBackingModel.file,
    url: leadBackingModel.sourceUrl,
    sha256: leadBackingModel.sha256,
    path: join(modelsPath, leadBackingModel.relativePath),
    handlers,
  });

  return {
    vocalsModelPath,
    vocalsModelDataPath,
    leadBackingModelPath,
  };
};
