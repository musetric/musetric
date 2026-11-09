import { maxTempoRatio, minTempoRatio } from '@musetric/audio';
import { engine } from '../../../engine/engine.js';

export const tempoStepsPerRatio = 20;

export const stepTempo = (steps: number) => {
  const state = engine.store.get();
  const next = Math.round(state.tempoRatio * tempoStepsPerRatio) + steps;
  if (
    state.recording ||
    next < Math.round(minTempoRatio * tempoStepsPerRatio) ||
    next > Math.round(maxTempoRatio * tempoStepsPerRatio)
  ) {
    return;
  }
  engine.store.update((draft) => {
    draft.tempoRatio = next / tempoStepsPerRatio;
  });
};
