import { type EngineSeekEvent, type EngineSeekOrigin } from '@musetric/engine';
import { engine } from './engine.js';

export const subscribeForeignSeek = (
  origin: EngineSeekOrigin,
  onForeignSeek: (seekEvent: EngineSeekEvent) => void,
) =>
  engine.store.subscribe(
    (state) => state.seekEvent.revision,
    () => {
      const { seekEvent } = engine.store.get();
      if (seekEvent.origin === origin) return;
      onForeignSeek(seekEvent);
    },
  );
