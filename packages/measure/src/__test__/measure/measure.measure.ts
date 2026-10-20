import { inject, it } from 'vitest';
import { runDelay } from '../../delay.node.js';
import {
  type MeasureCommand,
  type MeasureRequest,
} from '../../session.node.js';
import { runSound } from '../../sound.node.js';
import { runTiming } from '../../timing.node.js';

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
