import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeMonoPcm } from '@musetric/ffmpeg';
import { type Logger, type MessageHandlers } from '@musetric/utils';
import { skeyModel } from '../models/skeyModel.js';
import { createSkeyRuntime } from '../runtime/key/skeyRuntime.js';
import { ensureSkeyModelFiles } from '../service/skeyModelCache.node.js';
import { peakNormalize, resolveKeyResult } from './keyProbabilities.es.js';

export type AnalyzeKeyMessage =
  | {
      type: 'progress';
      progress: number;
    }
  | {
      type: 'download';
      label: string;
      file?: string;
      downloaded: number;
      total?: number;
      status?: 'processing' | 'cached' | 'done';
    };

export type AnalyzeKeyOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeKeyMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeKey = async (options: AnalyzeKeyOptions): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await handlers.progress({ type: 'progress', progress: 0 });

  const modelPath = await ensureSkeyModelFiles({ modelsPath, handlers });

  const pcm = await decodeMonoPcm({
    sourcePath,
    sampleRate: skeyModel.sampleRate,
    logger,
  });
  const audio = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  peakNormalize(audio);

  const runtime = await createSkeyRuntime({ modelPath });
  const probs = await runtime
    .analyze(audio)
    .finally(async () => runtime.release());

  const result = resolveKeyResult(probs);

  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, undefined, 2), 'utf-8');
  await handlers.progress({ type: 'progress', progress: 1 });
};
