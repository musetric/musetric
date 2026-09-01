import { type api } from '@musetric/api';
import { assertNever } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';

export type ProcessingStepKind =
  | 'separation'
  | 'transcription'
  | 'rhythm'
  | 'key'
  | 'chords';
const stepOrder: ProcessingStepKind[] = [
  'separation',
  'transcription',
  'rhythm',
  'key',
  'chords',
];

const doneStep: api.project.ProcessingStep = { status: 'done', progress: 1 };
const pendingStep: api.project.ProcessingStep = { status: 'pending' };

const buildSteps = (
  step: ProcessingStepKind,
  current: api.project.ProcessingStep,
): api.project.ProcessingSteps => {
  const targetIndex = stepOrder.indexOf(step);
  const stepValue = (name: ProcessingStepKind): api.project.ProcessingStep => {
    const index = stepOrder.indexOf(name);
    if (index < targetIndex) {
      return doneStep;
    }
    if (index === targetIndex) {
      return current;
    }
    return pendingStep;
  };
  return {
    separation: stepValue('separation'),
    transcription: stepValue('transcription'),
    rhythm: stepValue('rhythm'),
    key: stepValue('key'),
    chords: stepValue('chords'),
  };
};

const lastStep = stepOrder[stepOrder.length - 1];

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
  error: string;
};

export type ProcessingWorkerEvent =
  | ProcessingWorkerProgressEvent
  | ProcessingWorkerCompleteEvent
  | ProcessingWorkerErrorEvent;

export const resolveProcessingEvent = (
  event: ProcessingWorkerEvent,
): api.project.Processing => {
  if (event.type === 'progress') {
    const current: api.project.ProcessingStep = {
      status: 'processing',
      progress: event.progress,
      download: event.download,
    };
    return { done: false, steps: buildSteps(event.step, current) };
  }

  if (event.type === 'complete') {
    return {
      done: event.step === lastStep,
      steps: buildSteps(event.step, doneStep),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (event.type === 'error') {
    return {
      done: false,
      steps: buildSteps(event.step, {
        status: 'failed',
        error: event.error,
      }),
    };
  }

  return assertNever(event, 'Unhandled processing worker event');
};

export const resolveProcessing = async (
  app: FastifyInstance,
  projectId: number,
): Promise<api.project.Processing> => {
  const active = app.processingWorker.getProcessingState(projectId);
  if (active) {
    return resolveProcessingEvent(active);
  }

  const [subtitle, rhythm, key, chords, lead, errors] = await Promise.all([
    app.db.subtitle.getByProject(projectId),
    app.db.rhythm.getByProject(projectId),
    app.db.key.getByProject(projectId),
    app.db.chords.getByProject(projectId),
    app.db.audioMaster.get(projectId, 'lead'),
    app.db.processing.getErrorsByProject(projectId),
  ]);

  const errorsByStep = new Map(
    errors.map((error) => [error.step, error.message]),
  );
  const stepFor = (
    step: ProcessingStepKind,
    present: unknown,
  ): api.project.ProcessingStep => {
    const error = errorsByStep.get(step);
    if (error !== undefined) {
      return { status: 'failed', error };
    }
    return present ? doneStep : pendingStep;
  };

  return {
    done: errors.length === 0 && !!subtitle && !!rhythm && !!key && !!chords,
    steps: {
      separation: stepFor('separation', lead),
      transcription: stepFor('transcription', subtitle),
      rhythm: stepFor('rhythm', rhythm),
      key: stepFor('key', key),
      chords: stepFor('chords', chords),
    },
  };
};
