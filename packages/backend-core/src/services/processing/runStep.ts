import { api } from '@musetric/api';
import { type z } from 'zod';
import { runKey } from './key.js';
import { runRhythm } from './rhythm.js';
import { runSeparation } from './separation.js';
import { runTranscription } from './transcription.js';
import { type ProcessingContext, type ProcessingStep } from './types.js';

export const fastifyStepSchema = api.project.processingStepNameSchema.exclude([
  'chords',
]);
export type FastifyStepName = z.infer<typeof fastifyStepSchema>;

const steps: Record<FastifyStepName, ProcessingStep> = {
  separation: runSeparation,
  transcription: runTranscription,
  rhythm: runRhythm,
  key: runKey,
};

const failureMessages: Record<FastifyStepName, string> = {
  separation: 'Separation failed',
  transcription: 'Transcription failed',
  rhythm: 'Rhythm analysis failed',
  key: 'Key detection failed',
};

export const runProcessingStep = async (
  step: FastifyStepName,
  context: ProcessingContext,
): Promise<void> => {
  await steps[step](context);
};

export const readStepFailure = (
  step: FastifyStepName,
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
