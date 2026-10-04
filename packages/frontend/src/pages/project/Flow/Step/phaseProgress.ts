import { type api } from '@musetric/api';

export const getPhaseShare = (
  step: api.project.ProcessingStep,
): number | undefined => {
  const { phase, decoded, loaded, total } = step;
  if (phase === 'loading') {
    return loaded !== undefined && total ? loaded / total : 0;
  }
  if (phase === 'decoding' && decoded !== undefined && total) {
    return decoded / total;
  }
  return undefined;
};
