import { type VocalLessonConcept } from '@musetric/spectrogram';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type LessonActivity = 'listening' | 'singing' | 'waiting';

export type LessonPlace = {
  start: number;
  end: number;
  focusStart: number;
  focusEnd: number;
};

export type LessonState = {
  open: boolean;
  chosen: boolean;
  places: LessonPlace[];
  index: number;
  attempts: number;
  activity?: LessonActivity;
  activityId: number;
  explained: VocalLessonConcept[];
};

export type LessonActions = {
  setOpen: (open: boolean) => void;
  choose: (places: LessonPlace[]) => void;
  goTo: (index: number) => void;
  startActivity: (activity: LessonActivity) => number;
  continueActivity: (id: number, activity: LessonActivity) => void;
  endActivity: (id: number) => void;
  countAttempt: () => void;
  explain: (concept: VocalLessonConcept) => void;
};

export const useLessonStore = create<LessonState & LessonActions>()(
  subscribeWithSelector((set, get) => ({
    open: false,
    chosen: false,
    places: [],
    index: 0,
    attempts: 0,
    activityId: 0,
    explained: [],
    setOpen: (open) =>
      set({
        open,
        chosen: false,
        places: [],
        index: 0,
        attempts: 0,
        activity: undefined,
      }),
    choose: (places) => set({ chosen: true, places, index: 0, attempts: 0 }),
    goTo: (index) => set({ index, attempts: 0 }),
    startActivity: (activity) => {
      const activityId = get().activityId + 1;
      set({ activity, activityId });
      return activityId;
    },
    continueActivity: (id, activity) => {
      if (get().activityId === id) {
        set({ activity });
      }
    },
    endActivity: (id) => {
      if (get().activityId === id) {
        set({ activity: undefined });
      }
    },
    countAttempt: () => set((state) => ({ attempts: state.attempts + 1 })),
    explain: (concept) =>
      set((state) =>
        state.explained.includes(concept)
          ? state
          : { explained: [...state.explained, concept] },
      ),
  })),
);

export const isWholePass = (state: LessonState): boolean =>
  state.chosen && state.places.length > 0 && state.index >= state.places.length;
