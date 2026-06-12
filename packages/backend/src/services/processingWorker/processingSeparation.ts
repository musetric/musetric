import { separateAudio } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/resource-utils';
import { convertToFmp4, generateWavePeaks } from '@musetric/toolkit';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

export type SeparationTask = {
  projectId: number;
  blobId: string;
};

export type SeparationWorker = {
  run: (task: SeparationTask) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export const createSeparationWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): SeparationWorker => {
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step: 'separation',
          progress: 0,
        };
        emitter.emit(state);

        const project = await app.db.project.get(task.projectId);
        if (!project) {
          throw new Error(`Project with id ${task.projectId} not found`);
        }

        const masterSourcePath = app.blobStorage.getPath(task.blobId);
        const masterLead = app.blobStorage.createPath();
        const masterBacking = app.blobStorage.createPath();
        const masterInstrumental = app.blobStorage.createPath();

        await separateAudio({
          sourcePath: masterSourcePath,
          leadPath: masterLead.blobPath,
          backingPath: masterBacking.blobPath,
          instrumentalPath: masterInstrumental.blobPath,
          sampleRate: project.sampleRate,
          handlers: {
            progress: (message) => {
              if (!state) {
                return;
              }
              state = {
                ...state,
                progress: message.progress,
              };
              emitter.emit(state);
            },
            download: (message) => {
              if (!state) {
                return;
              }
              state = {
                ...state,
                download: message,
              };
              emitter.emit(state);
            },
          },
          modelsPath: envs.modelsPath,
          logger,
        });

        const deliveryLead = app.blobStorage.createPath();
        const deliveryBacking = app.blobStorage.createPath();
        const deliveryInstrumental = app.blobStorage.createPath();
        await Promise.all([
          convertToFmp4({
            fromPath: masterLead.blobPath,
            toPath: deliveryLead.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
          convertToFmp4({
            fromPath: masterBacking.blobPath,
            toPath: deliveryBacking.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
          convertToFmp4({
            fromPath: masterInstrumental.blobPath,
            toPath: deliveryInstrumental.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
        ]);

        const wavePeaksLead = app.blobStorage.createPath();
        const wavePeaksBacking = app.blobStorage.createPath();
        const wavePeaksInstrumental = app.blobStorage.createPath();
        await Promise.all([
          generateWavePeaks({
            fromPath: masterLead.blobPath,
            toPath: wavePeaksLead.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
          generateWavePeaks({
            fromPath: masterBacking.blobPath,
            toPath: wavePeaksBacking.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
          generateWavePeaks({
            fromPath: masterInstrumental.blobPath,
            toPath: wavePeaksInstrumental.blobPath,
            sampleRate: project.sampleRate,
            logger,
          }),
        ]);

        await app.db.processing.applySeparationResult({
          projectId: task.projectId,
          master: {
            leadId: masterLead.blobId,
            backingId: masterBacking.blobId,
            instrumentalId: masterInstrumental.blobId,
          },
          delivery: {
            leadId: deliveryLead.blobId,
            backingId: deliveryBacking.blobId,
            instrumentalId: deliveryInstrumental.blobId,
          },
          wavePeaks: {
            leadId: wavePeaksLead.blobId,
            backingId: wavePeaksBacking.blobId,
            instrumentalId: wavePeaksInstrumental.blobId,
          },
        });

        state = undefined;
        emitter.emit({
          type: 'complete',
          projectId: task.projectId,
          step: 'separation',
        });
      } catch (error) {
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step: 'separation',
        });
        state = undefined;
        logger.error({ projectId: task.projectId, error }, 'Separation failed');
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
