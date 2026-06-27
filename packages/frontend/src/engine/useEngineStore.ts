import { type EngineState } from '@musetric/engine';
import { useSyncExternalStore } from 'react';
import { engine } from './engine.js';

export const useEngineStore = <Value>(
  selector: (state: EngineState) => Value,
) =>
  useSyncExternalStore(
    engine.store.subscribeState,
    () => selector(engine.store.get()),
    () => selector(engine.store.get()),
  );
