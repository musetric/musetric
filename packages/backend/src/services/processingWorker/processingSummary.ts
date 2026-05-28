import type { api } from '@musetric/api';
import type { FastifyInstance } from 'fastify';

export type ProcessingStepKind = 'separation' | 'transcription' | 'rhythm';
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

const doneStep: api.project.ProcessingStep = { status: 'done', progress: 1 };
const pendingStep: api.project.ProcessingStep = { status: 'pending' };

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
          transcription: pendingStep,
          rhythm: pendingStep,
        },
      };
    }
    if (event.step === 'transcription') {
      return {
        done: false,
        steps: {
          separation: doneStep,
          transcription: {
            status: 'processing',
            progress: event.progress,
            download: event.download,
          },
          rhythm: pendingStep,
        },
      };
    }
    return {
      done: false,
      steps: {
        separation: doneStep,
        transcription: doneStep,
        rhythm: {
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
          separation: doneStep,
          transcription: pendingStep,
          rhythm: pendingStep,
        },
      };
    }
    if (event.step === 'transcription') {
      return {
        done: false,
        steps: {
          separation: doneStep,
          transcription: doneStep,
          rhythm: pendingStep,
        },
      };
    }
    return {
      done: true,
      steps: {
        separation: doneStep,
        transcription: doneStep,
        rhythm: doneStep,
      },
    };
  }

  if (event.step === 'separation') {
    return {
      done: false,
      steps: {
        separation: pendingStep,
        transcription: pendingStep,
        rhythm: pendingStep,
      },
    };
  }
  if (event.step === 'transcription') {
    return {
      done: false,
      steps: {
        separation: doneStep,
        transcription: pendingStep,
        rhythm: pendingStep,
      },
    };
  }
  return {
    done: false,
    steps: {
      separation: doneStep,
      transcription: doneStep,
      rhythm: pendingStep,
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

  const [subtitle, rhythm, lead, source] = await Promise.all([
    app.db.subtitle.getByProject(projectId),
    app.db.rhythm.getByProject(projectId),
    app.db.audioMaster.get(projectId, 'lead'),
    app.db.audioMaster.get(projectId, 'source'),
  ]);

  if (subtitle && rhythm) {
    return {
      done: true,
      steps: {
        separation: doneStep,
        transcription: doneStep,
        rhythm: doneStep,
      },
    };
  }

  if (lead) {
    return {
      done: false,
      steps: {
        separation: doneStep,
        transcription: subtitle ? doneStep : pendingStep,
        rhythm: rhythm ? doneStep : pendingStep,
      },
    };
  }

  if (source) {
    return {
      done: false,
      steps: {
        separation: pendingStep,
        transcription: pendingStep,
        rhythm: pendingStep,
      },
    };
  }

  return {
    done: false,
    steps: {
      separation: pendingStep,
      transcription: pendingStep,
      rhythm: pendingStep,
    },
  };
};
