import { transcribeAudio } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { type AnalysisWorker, createAnalysisWorker } from './analysisWorker.js';
import { type ProcessingWorkerEvent } from './processingSummary.js';

export type TranscriptionTask = {
  projectId: number;
  blobId: string;
};

export type TranscriptionWorker = AnalysisWorker<TranscriptionTask>;

export const createTranscriptionWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): TranscriptionWorker =>
  createAnalysisWorker<TranscriptionTask>(emitter, logger, {
    step: 'transcription',
    errorMessage: 'Transcription failed',
    process: async (task, handlers) => {
      const sourcePath = app.blobStorage.getPath(task.blobId);
      const transcription = app.blobStorage.createPath();

      await transcribeAudio({
        gpuHost: app.gpuHost,
        sourcePath,
        resultPath: transcription.blobPath,
        handlers,
        modelsPath: app.config.modelsPath,
        logger,
      });

      await app.db.processing.applyTranscriptionResult({
        projectId: task.projectId,
        blobId: transcription.blobId,
      });
    },
  });
