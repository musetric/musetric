/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  createGuardedPlayer,
  type GuardedPlayer,
} from './guardedPlayer.worklet.js';
import { playerProcessorName } from './protocol.cross.js';

const measure = import.meta.env.frontendMeasure === 'true';

export class PlayerProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  readonly player: GuardedPlayer;

  constructor() {
    super();
    this.player = createGuardedPlayer({
      port: this.port,
      sampleRate,
      getCurrentTime: () => currentTime,
      getCurrentFrame: () => currentFrame,
      measure,
    });
    if (this.player.injectFault) {
      // eslint-disable-next-line musetric/no-global-state -- the measure build gives the external driver one entry point
      Object.assign(globalThis, {
        musetricMeasureHooks: { injectPlayerFault: this.player.injectFault },
      });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.player.process(inputs, outputs[0]);
    return true;
  }
}

registerProcessor(playerProcessorName, PlayerProcessor);
