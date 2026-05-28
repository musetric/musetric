import {
  bindLogger,
  createEventEmitter,
  type EventEmitter,
} from '@musetric/resource-utils';
import { type Scheduler } from '@musetric/resource-utils/cross/scheduler';
import { createSingleWorker } from '@musetric/resource-utils/cross/singleWorker';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import { createRhythmWorker } from './processingRhythm.js';
import { createSeparationWorker } from './processingSeparation.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';
import { createTranscriptionWorker } from './processingTranscription.js';

export type ProcessingWorker = Scheduler & {
  emitter: EventEmitter<ProcessingWorkerEvent>;
  getProcessingState: (
    projectId: number,
  ) => ProcessingWorkerProgressEvent | undefined;
};

export const createProcessingWorker = (
  app: FastifyInstance,
): ProcessingWorker => {
  const emitter = createEventEmitter<ProcessingWorkerEvent>();
  const logger = bindLogger(app.log, envs.logLevel);
  const separationWorker = createSeparationWorker(app, emitter, logger);
  const transcriptionWorker = createTranscriptionWorker(app, emitter, logger);
  const rhythmWorker = createRhythmWorker(app, emitter, logger);

  const worker = createSingleWorker({
    intervalMs: envs.processingIntervalMs,
    runNext: async () => {
      const transcription = await app.db.processing.pendingTranscription();
      if (transcription) {
        await transcriptionWorker.run(transcription);
      }

      const rhythm = await app.db.processing.pendingRhythm();
      if (rhythm) {
        await rhythmWorker.run(rhythm);
      }

      const separation = await app.db.processing.pendingSeparation();
      if (separation) {
        await separationWorker.run(separation);
      }
    },
  });

  return {
    ...worker,
    emitter,
    getProcessingState: (projectId) => {
      return (
        transcriptionWorker.getState(projectId) ??
        rhythmWorker.getState(projectId) ??
        separationWorker.getState(projectId)
      );
    },
  };
};
