import { initSync } from '@musetric/dsp/stretch';
import { type PortDispatch } from '@musetric/utils/cross/messagePort';
import {
  playerChannel,
  playerDataChannel,
  type PlayerInboundMethods,
} from './protocol.cross.js';
import { createPlayerRuntime, type PlayerRuntime } from './runtime.worklet.js';

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export type CreateGuardedPlayerOptions = {
  port: MessagePort;
  sampleRate: number;
  getCurrentFrame: () => number;
  measure: boolean;
};

export type PlayerFault = 'caught' | 'uncaught';

export type GuardedPlayer = {
  process: (inputs: Float32Array[][], output: Float32Array[]) => void;
  injectFault?: (fault: PlayerFault) => void;
};

export const createGuardedPlayer = (
  options: CreateGuardedPlayerOptions,
): GuardedPlayer => {
  let runtime: PlayerRuntime | undefined = undefined;
  let failed = false;
  let fault: PlayerFault | undefined = undefined;
  let sendFailed: PlayerInboundMethods['failed'] | undefined = undefined;

  const fail = (error: unknown) => {
    failed = true;
    runtime = undefined;
    // eslint-disable-next-line musetric/no-audio-thread-allocations -- once, when the player fails and goes silent
    sendFailed?.({ reason: describeError(error) });
  };

  const dispatch: PortDispatch = (handler, payload) => {
    if (failed) {
      return;
    }
    try {
      handler(payload);
    } catch (error) {
      fail(error);
    }
  };

  const port = playerChannel.inboundSync(options.port, dispatch);
  sendFailed = port.methods.failed;
  port.bindBoot((message) => {
    runtime = createPlayerRuntime({
      port,
      dataPort: playerDataChannel.inboundSync(message.dataPort, dispatch),
      playheadPorts: message.playheadPorts,
      sampleRate: options.sampleRate,
      stretch: initSync({ module: message.stretchModule }),
      getCurrentFrame: options.getCurrentFrame,
    });
    port.methods.booted();
  });

  return {
    process: (inputs, output) => {
      if (fault === 'uncaught') {
        fault = undefined;
        // eslint-disable-next-line musetric/no-audio-thread-allocations -- a fault the measure build injects, once
        throw new Error('A fault injected out of the player');
      }
      if (runtime) {
        try {
          if (fault === 'caught') {
            fault = undefined;
            // eslint-disable-next-line musetric/no-audio-thread-allocations -- a fault the measure build injects, once
            throw new Error('A fault injected into the player');
          }
          runtime.process(inputs, output);
          return;
        } catch (error) {
          fail(error);
        }
      }
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
    },
    injectFault: options.measure
      ? (next) => {
          fault = next;
        }
      : undefined,
  };
};
