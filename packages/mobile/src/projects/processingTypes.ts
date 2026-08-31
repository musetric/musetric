import { type api } from '@musetric/api';

export type MobileProjectProcessing = Omit<
  api.project.Processing,
  'steps'
> & {
  steps: {
    [Step in keyof api.project.ProcessingSteps]: api.project.ProcessingStep;
  };
};
