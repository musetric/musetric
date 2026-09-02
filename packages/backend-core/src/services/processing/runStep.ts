import { type api } from '@musetric/api';
import { runChords } from './chords.js';
import { runKey } from './key.js';
import { runRhythm } from './rhythm.js';
import { runSeparation } from './separation.js';
import { runTranscription } from './transcription.js';
import { type ProcessingContext, type ProcessingStep } from './types.js';

const steps: Record<api.project.ProcessingStepName, ProcessingStep> = {
  separation: runSeparation,
  transcription: runTranscription,
  rhythm: runRhythm,
  key: runKey,
  chords: runChords,
};

const failureMessages: Record<api.project.ProcessingStepName, string> = {
  separation: 'Separation failed',
  transcription: 'Transcription failed',
  rhythm: 'Rhythm analysis failed',
  key: 'Key detection failed',
  chords: 'Chord detection failed',
};

export const runProcessingStep = async (
  step: api.project.ProcessingStepName,
  context: ProcessingContext,
): Promise<void> => {
  await steps[step](context);
};

export const readStepFailure = (
  step: api.project.ProcessingStepName,
  error: unknown,
): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return failureMessages[step];
};
