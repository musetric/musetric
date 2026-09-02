import { type api } from '@musetric/api';
import { type FastifyInstance } from 'fastify';

const doneStep: api.project.ProcessingStep = { status: 'done', progress: 1 };
const pendingStep: api.project.ProcessingStep = { status: 'pending' };

export const resolveProcessing = async (
  app: FastifyInstance,
  projectId: number,
): Promise<api.project.Processing> => {
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
    step: api.project.ProcessingStepName,
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
