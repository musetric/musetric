import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type Logger } from '@musetric/utils';
import { type GpuHost } from './gpuHost.node.js';
import { type GpuPageProgressHandler } from './gpuPageHost.node.js';
import { type GpuModuleRoute } from './headlessGpuModuleServer.node.js';
import { runGpuAnalysis } from './headlessGpuPage.node.js';
import { sendFile } from './httpFile.node.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
  transcribeAudioApiName,
} from './transcribeApi.js';
import { whisperCacheDirName } from './whisperModelCache.node.js';

const hfRoute = '/hf/';

type ServeHfFileOptions = {
  relPath: string;
  search: string;
  cacheDir: string;
  response: ServerResponse;
  logger: Logger;
};

const serveHfFile = async (options: ServeHfFileOptions): Promise<void> => {
  const { relPath, search, cacheDir, response, logger } = options;
  const safe = relPath.replace(/\.\.+/g, '').replace(/[^a-zA-Z0-9._/-]/g, '_');
  const filePath = join(cacheDir, safe);
  if (existsSync(filePath)) {
    await sendFile(filePath, response);
    return;
  }

  const upstream = `https://huggingface.co/${relPath}${search}`;
  const upstreamResponse = await fetch(upstream);
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    logger.warn(
      { upstream, status: upstreamResponse.status },
      'HF fetch failed',
    );
    response.writeHead(upstreamResponse.status || 502);
    response.end('hf fetch failed');
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await pipeline(
    Readable.fromWeb(upstreamResponse.body),
    createWriteStream(tempPath),
  );
  await rename(tempPath, filePath);
  await sendFile(filePath, response);
};

const createHfCacheRoute =
  (cacheDir: string, logger: Logger): GpuModuleRoute =>
  async (url, response) => {
    if (!url.pathname.startsWith(hfRoute)) {
      return false;
    }
    await serveHfFile({
      relPath: url.pathname.slice(hfRoute.length),
      search: url.search,
      cacheDir,
      response,
      logger,
    });
    return true;
  };

export type HeadlessTranscribeOptions = {
  gpuHost: GpuHost;
  logger: Logger;

  pcm: Buffer;
  sampleRate: number;
  modelId: string;
  revision: string;
  language?: string;

  modelsPath: string;
  onProgress: GpuPageProgressHandler;
};

export const transcribeAudioHeadless = async (
  options: HeadlessTranscribeOptions,
): Promise<BrowserTranscribeResult> => {
  const { gpuHost, logger, pcm, sampleRate, modelId, revision, language } =
    options;
  const cacheDir = join(options.modelsPath, whisperCacheDirName);
  return runGpuAnalysis<BrowserTranscribeRequest, BrowserTranscribeResult>({
    gpuHost,
    logger,
    label: 'Headless transcription',
    apiName: transcribeAudioApiName,
    requireShaderF16: true,
    pcm,
    routes: [createHfCacheRoute(cacheDir, logger)],
    onProgress: options.onProgress,
    onConsole: (text) => {
      logger.info({ browser: true }, `[browser] ${text}`);
    },
    onPageError: (message) => {
      logger.error({ browser: true }, `[browser] ${message}`);
    },
    buildRequest: (server) => ({
      pcmUrl: server.pcmUrl,
      sampleRate,
      modelHost: `${server.baseUrl}${hfRoute.slice(0, -1)}`,
      modelId,
      revision,
      language,
    }),
  });
};
