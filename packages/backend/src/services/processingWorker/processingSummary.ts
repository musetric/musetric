import type { api } from '@musetric/api';
import type { FastifyInstance } from 'fastify';

export type ProcessingStepKind = 'separation' | 'transcription';
export type ProcessingWorkerProgressEvent = {
  type: 'progress';
  projectId: number;
  step: ProcessingStepKind;
  progress: number;
  download?: api.project.Download;
};

export type ProcessingWorkerCompleteEvent = {
  type: 'complete';
  projectId: number;
  step: ProcessingStepKind;
};

export type ProcessingWorkerErrorEvent = {
  type: 'error';
  projectId: number;
  step: ProcessingStepKind;
};

export type ProcessingWorkerEvent =
  | ProcessingWorkerProgressEvent
  | ProcessingWorkerCompleteEvent
  | ProcessingWorkerErrorEvent;

export const resolveProcessingEvent = (
  event: ProcessingWorkerEvent,
): api.project.Processing => {
  if (event.type === 'progress') {
    if (event.step === 'separation') {
      return {
        done: false,
        steps: {
          separation: {
            status: 'processing',
            progress: event.progress,
            download: event.download,
          },
          transcription: {
            status: 'pending',
          },
        },
      };
    }

    return {
      done: false,
      steps: {
        separation: {
          status: 'done',
          progress: 1,
        },
        transcription: {
          status: 'processing',
          progress: event.progress,
          download: event.download,
        },
      },
    };
  }

  if (event.type === 'complete') {
    if (event.step === 'separation') {
      return {
        done: false,
        steps: {
          separation: { status: 'done', progress: 1 },
          transcription: { status: 'pending' },
        },
      };
    }

    return {
      done: true,
      steps: {
        separation: { status: 'done', progress: 1 },
        transcription: { status: 'done', progress: 1 },
      },
    };
  }

  if (event.step === 'separation') {
    return {
      done: false,
      steps: {
        separation: { status: 'pending' },
        transcription: { status: 'pending' },
      },
    };
  }

  return {
    done: false,
    steps: {
      separation: { status: 'done', progress: 1 },
      transcription: { status: 'pending' },
    },
  };
};

export const resolveProcessing = async (
  app: FastifyInstance,
  projectId: number,
): Promise<api.project.Processing> => {
  const active = app.processingWorker.getProcessingState(projectId);
  if (active) {
    return resolveProcessingEvent(active);
  }

  const [subtitle, lead, source] = await Promise.all([
    app.db.subtitle.getByProject(projectId),
    app.db.audioMaster.get(projectId, 'lead'),
    app.db.audioMaster.get(projectId, 'source'),
  ]);

  if (subtitle) {
    return {
      done: true,
      steps: {
        separation: { status: 'done', progress: 1 },
        transcription: { status: 'done', progress: 1 },
      },
    };
  }

  if (lead) {
    return {
      done: false,
      steps: {
        separation: { status: 'done', progress: 1 },
        transcription: { status: 'pending' },
      },
    };
  }

  if (source) {
    return {
      done: false,
      steps: {
        separation: { status: 'pending' },
        transcription: { status: 'pending' },
      },
    };
  }

  return {
    done: false,
    steps: {
      separation: { status: 'pending' },
      transcription: { status: 'pending' },
    },
  };
};
