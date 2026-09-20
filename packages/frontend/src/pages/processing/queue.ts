import { type api } from '@musetric/api';

export const stepOrder: api.project.ProcessingStepName[] = [
  'separation',
  'voices',
  'transcription',
  'rhythm',
  'key',
  'chords',
];

export type RunningStep = {
  name: api.project.ProcessingStepName;
  step: api.project.ProcessingStep;
};

export const runningStep = (
  projectItem: api.project.Item,
): RunningStep | undefined => {
  for (const name of stepOrder) {
    const step = projectItem.processing.steps[name];
    if (step.status === 'processing') {
      return { name, step };
    }
  }
  return undefined;
};

export const doneCount = (projectItem: api.project.Item): number =>
  stepOrder.filter(
    (name) => projectItem.processing.steps[name].status === 'done',
  ).length;

const byPosition = (left: api.project.Item, right: api.project.Item): number =>
  left.position - right.position;

export const queued = (projects: api.project.Item[]): api.project.Item[] =>
  projects.filter((item) => !item.processing.done).sort(byPosition);

export const finished = (projects: api.project.Item[]): api.project.Item[] =>
  projects.filter((item) => item.processing.done).sort(byPosition);
