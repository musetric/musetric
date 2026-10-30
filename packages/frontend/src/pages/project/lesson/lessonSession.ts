import { pickLessonPlaces } from '@musetric/spectrogram';
import { engine } from '../../../engine/engine.js';
import { useProjectStore } from '../store.js';
import { toLessonPlace } from './lessonPhrase.js';
import { waitForEngine } from './lessonPlay.js';
import { useLessonStore } from './lessonStore.js';

const analysisTimeoutMs = 8000;

export const openLesson = () => {
  useLessonStore.getState().setOpen(true);
  useProjectStore.getState().setSpectrogramOpen(true);
  engine.store.update((state) => {
    state.spectrogramView = 'spectrum';
    state.vocalLessonEnabled = true;
  });
};

export const closeLesson = () => {
  useLessonStore.getState().setOpen(false);
  engine.store.update((state) => {
    state.vocalLessonEnabled = false;
  });
};

export const chooseLessonPlaces = () => {
  const { vocalLessonStatus, vocalLessonPhrases } = engine.store.get();
  const lesson = useLessonStore.getState();
  if (!lesson.open || lesson.chosen || vocalLessonStatus !== 'ready') {
    return;
  }
  lesson.choose(pickLessonPlaces(vocalLessonPhrases).map(toLessonPlace));
};

export const subscribeLessonPlaces = () => {
  chooseLessonPlaces();
  const unsubscribes = [
    engine.store.subscribe(
      (state) => state.vocalLessonStatus,
      chooseLessonPlaces,
    ),
    useLessonStore.subscribe((state) => state.chosen, chooseLessonPlaces),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
};

export const waitForLessonAnalysis = async () => {
  let analyzing = false;
  await waitForEngine({
    select: (state) => state.vocalLessonStatus,
    done: (status) => {
      analyzing ||= status === 'analyzing';
      return analyzing && status === 'ready';
    },
    timeoutMs: analysisTimeoutMs,
  });
};
