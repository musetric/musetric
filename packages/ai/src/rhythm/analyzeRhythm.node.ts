import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger, type MessageHandlers } from '@musetric/utils';
import { beatThisModel } from '../models/beatThisModel.js';
import { decodeMonoPcm } from '../service/audioCodec.node.js';
import { ensureBeatThisModelFiles } from '../service/beatThisModelCache.node.js';
import { analyzeRhythmHeadless } from '../service/headlessRhythmService.node.js';
import { pickBeatTimes } from './beatPeaks.js';
import { estimateBpm, estimateMeter } from './rhythmSummary.js';
import { type RhythmResult } from './types.js';

export type AnalyzeRhythmMessage =
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

export type AnalyzeRhythmOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeRhythmMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeRhythm = async (
  options: AnalyzeRhythmOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await handlers.progress({ type: 'progress', progress: 0 });

  const modelFiles = await ensureBeatThisModelFiles({ modelsPath, handlers });

  const pcm = await decodeMonoPcm({
    sourcePath,
    sampleRate: beatThisModel.sampleRate,
    downmix: 'mean',
    logger,
  });
  const logits = await analyzeRhythmHeadless({
    logger,
    pcm,
    modelPath: modelFiles.modelPath,
    filterbankPath: modelFiles.filterbankPath,
    onProgress: async (progress) => {
      await handlers.progress({ type: 'progress', progress });
    },
  });

  const { beats, downbeats } = pickBeatTimes(logits.beat, logits.downbeat);
  const result: RhythmResult = {
    bpm: estimateBpm(beats),
    beats,
    downbeats,
    meter: estimateMeter(beats, downbeats),
  };

  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, undefined, 2), 'utf-8');
  await handlers.progress({ type: 'progress', progress: 1 });
};
