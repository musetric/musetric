export type EventUnsubscribe = () => void;

export type EventListener<TEvent> = (event: TEvent) => Promise<void> | void;

export type EventEmitter<TEvent> = {
  emit: (event: TEvent) => void;
  subscribe: (listener: EventListener<TEvent>) => EventUnsubscribe;
  listenerCount: () => number;
  clear: () => void;
};

export const createEventEmitter = <TEvent>(): EventEmitter<TEvent> => {
  const listeners = new Set<EventListener<TEvent>>();

  return {
    emit: (event) => {
      for (const listener of listeners) {
        void Promise.resolve().then(() => {
          void listener(event);
        });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    clear: () => {
      listeners.clear();
    },
  };
};
