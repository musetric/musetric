import type { api } from '@musetric/api';
import type { FastifyInstance } from 'fastify';

export type ProcessingStepKind =
  | 'separation'
  | 'transcription'
  | 'rhythm'
  | 'key'
  | 'chords';
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

type Steps = api.project.Processing['steps'];

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
): Steps => {
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

  return { done: false, steps: buildSteps(event.step, pendingStep) };
};

export const resolveProcessing = async (
  app: FastifyInstance,
  projectId: number,
): Promise<api.project.Processing> => {
  const active = app.processingWorker.getProcessingState(projectId);
  if (active) {
    return resolveProcessingEvent(active);
  }

  const [subtitle, rhythm, key, chords, lead] = await Promise.all([
    app.db.subtitle.getByProject(projectId),
    app.db.rhythm.getByProject(projectId),
    app.db.key.getByProject(projectId),
    app.db.chords.getByProject(projectId),
    app.db.audioMaster.get(projectId, 'lead'),
  ]);

  const stepFor = (present: unknown): api.project.ProcessingStep =>
    present ? doneStep : pendingStep;

  if (subtitle && rhythm && key && chords) {
    return {
      done: true,
      steps: {
        separation: doneStep,
        transcription: doneStep,
        rhythm: doneStep,
        key: doneStep,
        chords: doneStep,
      },
    };
  }

  if (lead) {
    return {
      done: false,
      steps: {
        separation: doneStep,
        transcription: stepFor(subtitle),
        rhythm: stepFor(rhythm),
        key: stepFor(key),
        chords: stepFor(chords),
      },
    };
  }

  return {
    done: false,
    steps: {
      separation: pendingStep,
      transcription: pendingStep,
      rhythm: pendingStep,
      key: pendingStep,
      chords: pendingStep,
    },
  };
};
