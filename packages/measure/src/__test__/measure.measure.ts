import { inject, it } from 'vitest';
import { runDelay } from './driver/measureDelay.js';
import { runSound } from './driver/measureSound.js';
import { runTiming } from './driver/measureTiming.js';
import { type MeasureCommand, type MeasureRequest } from './driver/session.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    measureRequest?: MeasureRequest;
  }
}

const commands: Record<
  MeasureCommand,
  (request: MeasureRequest) => Promise<void>
> = {
  timing: runTiming,
  delay: runDelay,
  sound: runSound,
};

it('runs the measure command', async () => {
  const request = inject('measureRequest');
  if (!request) {
    return;
  }
  await commands[request.command](request);
});
