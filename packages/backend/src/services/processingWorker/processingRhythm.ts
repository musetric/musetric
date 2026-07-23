import { analyzeRhythm } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import { type AnalysisWorker, createAnalysisWorker } from './analysisWorker.js';
import { type ProcessingWorkerEvent } from './processingSummary.js';

export type RhythmTask = {
  projectId: number;
  blobId: string;
};

export type RhythmWorker = AnalysisWorker<RhythmTask>;

export const createRhythmWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): RhythmWorker =>
  createAnalysisWorker<RhythmTask>(emitter, logger, {
    step: 'rhythm',
    errorMessage: 'Rhythm analysis failed',
    process: async (task, handlers) => {
      const sourcePath = app.blobStorage.getPath(task.blobId);
      const rhythm = app.blobStorage.createPath();

      await analyzeRhythm({
        gpuHost: app.gpuHost,
        sourcePath,
        resultPath: rhythm.blobPath,
        handlers,
        modelsPath: envs.modelsPath,
        logger,
      });

      await app.db.processing.applyRhythmResult({
        projectId: task.projectId,
        blobId: rhythm.blobId,
      });
    },
  });
