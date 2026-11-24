import { type EngineState } from '@musetric/engine';
import { useSyncExternalStore } from 'react';
import { engine } from './engine.js';

export type EnginePositionSelector<Value> = (
  frameIndex: number,
  state: EngineState,
) => Value;

const select = <Value>(selector: EnginePositionSelector<Value>): Value =>
  selector(engine.position.read(), engine.store.get());

const subscribeChange = (callback: () => void): (() => void) => {
  const unsubscribePosition = engine.position.subscribe(callback);
  const unsubscribeState = engine.store.subscribeState(callback);
  return () => {
    unsubscribePosition();
    unsubscribeState();
  };
};

export const subscribeEnginePosition = <Value>(
  selector: EnginePositionSelector<Value>,
  callback: (value: Value) => void,
): (() => void) => {
  let value = select(selector);
  return subscribeChange(() => {
    const next = select(selector);
    if (Object.is(next, value)) {
      return;
    }
    value = next;
    callback(next);
  });
};

export const useEnginePosition = <Value>(
  selector: EnginePositionSelector<Value>,
): Value =>
  useSyncExternalStore(
    subscribeChange,
    () => select(selector),
    () => select(selector),
  );
