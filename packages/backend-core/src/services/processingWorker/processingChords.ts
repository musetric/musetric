import { analyzeChords } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { type AnalysisWorker, createAnalysisWorker } from './analysisWorker.js';
import { type ProcessingWorkerEvent } from './processingSummary.js';

export type ChordsTask = {
  projectId: number;
  blobId: string;
};

export type ChordsWorker = AnalysisWorker<ChordsTask>;

export const createChordsWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): ChordsWorker =>
  createAnalysisWorker<ChordsTask>(emitter, logger, {
    step: 'chords',
    errorMessage: 'Chord detection failed',
    process: async (task, handlers) => {
      const sourcePath = app.blobStorage.getPath(task.blobId);
      const chords = app.blobStorage.createPath();

      await analyzeChords({
        gpuHost: app.gpuHost,
        sourcePath,
        resultPath: chords.blobPath,
        handlers,
        modelsPath: app.config.modelsPath,
        logger,
      });

      await app.db.processing.applyChordsResult({
        projectId: task.projectId,
        blobId: chords.blobId,
      });
    },
  });
