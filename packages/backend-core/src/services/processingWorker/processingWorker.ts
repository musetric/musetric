import {
  bindLogger,
  createEventEmitter,
  type EventEmitter,
} from '@musetric/utils';
import { type Scheduler } from '@musetric/utils/cross/scheduler';
import { createSingleWorker } from '@musetric/utils/cross/singleWorker';
import { type FastifyInstance } from 'fastify';
import { processingIntervalMs } from '../../common/config.js';
import { createChordsWorker } from './processingChords.js';
import { createKeyWorker } from './processingKey.js';
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
  const logger = bindLogger(app.log, app.config.logLevel);
  const separationWorker = createSeparationWorker(app, emitter, logger);
  const transcriptionWorker = createTranscriptionWorker(app, emitter, logger);
  const rhythmWorker = createRhythmWorker(app, emitter, logger);
  const keyWorker = createKeyWorker(app, emitter, logger);
  const chordsWorker = createChordsWorker(app, emitter, logger);

  const worker = createSingleWorker({
    intervalMs: processingIntervalMs,
    runNext: async () => {
      const transcription = await app.db.processing.pendingTranscription();
      if (transcription) {
        await transcriptionWorker.run(transcription);
      }

      const rhythm = await app.db.processing.pendingRhythm();
      if (rhythm) {
        await rhythmWorker.run(rhythm);
      }

      const key = await app.db.processing.pendingKey();
      if (key) {
        await keyWorker.run(key);
      }

      const chords = await app.db.processing.pendingChords();
      if (chords) {
        await chordsWorker.run(chords);
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
    getProcessingState: (projectId) =>
      transcriptionWorker.getState(projectId) ??
      rhythmWorker.getState(projectId) ??
      keyWorker.getState(projectId) ??
      chordsWorker.getState(projectId) ??
      separationWorker.getState(projectId),
  };
};
