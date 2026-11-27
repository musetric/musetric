import { type EngineSeekEvent, type EngineSeekOrigin } from '@musetric/engine';
import { engine } from './engine.js';

export const subscribeForeignSeek = (
  origin: EngineSeekOrigin,
  onForeignSeek: (seekEvent: EngineSeekEvent) => void,
) =>
  engine.seeks.subscribe((seekEvent) => {
    if (seekEvent.origin === origin || seekEvent.origin === 'hold') return;
    onForeignSeek(seekEvent);
  });
