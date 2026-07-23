import { analyzeKey } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import { type AnalysisWorker, createAnalysisWorker } from './analysisWorker.js';
import { type ProcessingWorkerEvent } from './processingSummary.js';

export type KeyTask = {
  projectId: number;
  blobId: string;
};

export type KeyWorker = AnalysisWorker<KeyTask>;

export const createKeyWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): KeyWorker =>
  createAnalysisWorker<KeyTask>(emitter, logger, {
    step: 'key',
    errorMessage: 'Key detection failed',
    process: async (task, handlers) => {
      const sourcePath = app.blobStorage.getPath(task.blobId);
      const key = app.blobStorage.createPath();

      await analyzeKey({
        sourcePath,
        resultPath: key.blobPath,
        handlers,
        modelsPath: envs.modelsPath,
        logger,
      });

      await app.db.processing.applyKeyResult({
        projectId: task.projectId,
        blobId: key.blobId,
      });
    },
  });
