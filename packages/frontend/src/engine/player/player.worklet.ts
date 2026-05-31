/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  playerChannel,
  playerDataChannel,
  playerProcessorName,
} from '@musetric/audio/player';
import { createPlayerRuntime } from '@musetric/audio/player/worklet';

export class PlayerProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  constructor() {
    super();
    const port = playerChannel.inbound(this.port);
    port.bindBoot(async (message) => {
      const runtime = await createPlayerRuntime({
        port,
        dataPort: playerDataChannel.inbound(message.dataPort),
      });
      this.handleProcess = (
        inputs: Float32Array[][],
        output: Float32Array[],
      ) => {
        runtime.process(inputs, output);
        return true;
      };
      port.methods.booted();
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleProcess = (_inputs: Float32Array[][], _output: Float32Array[]) => {
    return true;
  };

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    return this.handleProcess(inputs, outputs[0]);
  }
}

registerProcessor(playerProcessorName, PlayerProcessor);
