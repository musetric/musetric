import { produce } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import * as zustand from 'zustand/vanilla';

type Unmount = () => void;

export type ReadonlyStore<State> = {
  get: () => State;
  subscribe: <Value>(
    selector: (state: State) => Value,
    callback: (value: Value) => void,
  ) => Unmount;
  subscribeState: (callback: (value: State) => void) => Unmount;
};

export type Store<State> = ReadonlyStore<State> & {
  update: (recipe: (state: State) => void) => void;
};

export const createStore = <State>(initialState: State): Store<State> => {
  const store = zustand.createStore<State>()(
    subscribeWithSelector(() => initialState),
  );

  return {
    get: store.getState,
    update: (recipe) => {
      store.setState((state) => produce(state, recipe));
    },
    subscribe: store.subscribe,
    subscribeState: store.subscribe,
  };
};
