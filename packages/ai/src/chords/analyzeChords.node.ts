import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger, type MessageHandlers } from '@musetric/utils';
import { chordNetModel } from '../models/chordNetModel.js';
import { decodeMonoPcm } from '../service/audioCodec.node.js';
import { ensureChordNetModelFiles } from '../service/chordNetModelCache.node.js';
import { analyzeChordsHeadless } from '../service/headlessChordsService.node.js';
import { buildChordSegments } from './chordSegments.js';

export type AnalyzeChordsMessage =
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

export type AnalyzeChordsOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeChordsMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeChords = async (
  options: AnalyzeChordsOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await handlers.progress({ type: 'progress', progress: 0 });

  const modelFiles = await ensureChordNetModelFiles({ modelsPath, handlers });

  const pcm = await decodeMonoPcm({
    sourcePath,
    sampleRate: chordNetModel.sampleRate,
    downmix: 'mean',
    logger,
  });
  const indices = await analyzeChordsHeadless({
    logger,
    pcm,
    modelPath: modelFiles.modelPath,
    planPath: modelFiles.planPath,
    planManifestPath: modelFiles.planManifestPath,
    onProgress: async (progress) => {
      await handlers.progress({ type: 'progress', progress });
    },
  });

  const result = buildChordSegments(indices, chordNetModel.frameDuration);

  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, undefined, 2), 'utf-8');
  await handlers.progress({ type: 'progress', progress: 1 });
};
