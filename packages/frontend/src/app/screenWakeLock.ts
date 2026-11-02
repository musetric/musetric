import { type api } from '@musetric/api';
import { type QueryClient } from '@tanstack/react-query';
import { endpoints } from '../api/index.js';
import { engine } from '../engine/engine.js';

const isWorking = (projects: api.project.Item[] | undefined): boolean =>
  (projects ?? []).some((project) =>
    Object.values(project.processing.steps).some(
      (step) => step.status === 'processing',
    ),
  );

type ScreenHold = (awake: boolean) => void;

type ScreenAwakeHandler = { postMessage: (awake: boolean) => void };

const createNativeHold = (handler: ScreenAwakeHandler): ScreenHold => {
  let held: boolean | undefined = undefined;

  return (awake) => {
    if (awake !== held) {
      held = awake;
      handler.postMessage(awake);
    }
  };
};

const createWakeLockHold = (wakeLock: WakeLock): ScreenHold => {
  let held: WakeLockSentinel | undefined = undefined;
  let pending = false;

  const apply = async (awake: boolean): Promise<void> => {
    if (awake === (held !== undefined) || pending) {
      return;
    }
    pending = true;
    try {
      if (awake) {
        held = await wakeLock.request('screen');
        held.addEventListener('release', () => {
          held = undefined;
        });
        return;
      }
      const releasing = held;
      held = undefined;
      await releasing?.release();
    } catch {
      held = undefined;
    } finally {
      pending = false;
    }
  };

  return (awake) => {
    void apply(awake);
  };
};

type ScreenAwakeWindow = Window & {
  webkit?: { messageHandlers?: { musetricScreenAwake?: ScreenAwakeHandler } };
};

const createScreenHold = (): ScreenHold | undefined => {
  const target: ScreenAwakeWindow = window;
  const handler = target.webkit?.messageHandlers?.musetricScreenAwake;
  if (handler) {
    return createNativeHold(handler);
  }
  return 'wakeLock' in navigator
    ? createWakeLockHold(navigator.wakeLock)
    : undefined;
};

export const holdScreenWhileWorking = (queryClient: QueryClient): void => {
  const hold = createScreenHold();
  if (!hold) {
    return;
  }

  const update = () => {
    const { playing, recording } = engine.store.get();
    const projects = queryClient.getQueryData(
      endpoints.project.list().queryKey,
    );
    hold(playing || recording || isWorking(projects));
  };

  queryClient.getQueryCache().subscribe(update);
  engine.store.subscribe((state) => state.playing || state.recording, update);
  document.addEventListener('visibilitychange', update);
};
