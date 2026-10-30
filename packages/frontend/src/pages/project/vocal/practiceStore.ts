import { type VocalMark, type VocalMarkKind } from '@musetric/spectrogram';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const placeToleranceSeconds = 0.3;
const stencilFades = [1, 0.6, 0.3, 0];

export type PracticeState = {
  kind?: VocalMarkKind;
  time: number;
  attempts: number;
  trying: boolean;
};

export type PracticeActions = {
  open: (kind: VocalMarkKind, time: number) => void;
  close: () => void;
  goTo: (time: number) => void;
  setTrying: (trying: boolean) => void;
  countAttempt: () => void;
};

export const usePracticeStore = create<PracticeState & PracticeActions>()(
  subscribeWithSelector((set) => ({
    time: 0,
    attempts: 0,
    trying: false,
    open: (kind, time) => set({ kind, time, attempts: 0, trying: false }),
    close: () => set({ kind: undefined, attempts: 0, trying: false }),
    goTo: (time) => set({ time, attempts: 0 }),
    setTrying: (trying) => set({ trying }),
    countAttempt: () => set((state) => ({ attempts: state.attempts + 1 })),
  })),
);

export const stencilFadeOf = (state: PracticeState): number =>
  state.kind
    ? stencilFades[Math.min(state.attempts, stencilFades.length - 1)]
    : 1;

export const practicePlaces = (
  marks: readonly VocalMark[],
  kind: VocalMarkKind,
): VocalMark[] =>
  marks
    .filter((mark) => mark.kind === kind && mark.advice !== undefined)
    .toSorted((left, right) => left.start - right.start);

export const findPlace = (
  places: readonly VocalMark[],
  time: number,
): VocalMark | undefined => {
  let best: VocalMark | undefined = undefined;
  let bestDistance = placeToleranceSeconds;
  for (const place of places) {
    const distance = Math.abs(place.start - time);
    if (distance <= bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
};
