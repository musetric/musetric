/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import { loadTimePitch } from '@musetric/audio/player';
import {
  playerChannel,
  playerDataChannel,
  playerProcessorName,
} from './protocol.cross.js';
import { createPlayerRuntime } from './runtime.worklet.js';

export class PlayerProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  constructor() {
    super();
    const port = playerChannel.inbound(this.port);
    port.bindBoot((message) => {
      const runtime = createPlayerRuntime({
        port,
        dataPort: playerDataChannel.inbound(message.dataPort),
        playheadPorts: message.playheadPorts,
        sampleRate,
        stretch: loadTimePitch(message.stretchModule),
        getCurrentTime: () => currentTime,
        getCurrentFrame: () => currentFrame,
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
  handleProcess = (_inputs: Float32Array[][], _output: Float32Array[]) => true;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    return this.handleProcess(inputs, outputs[0]);
  }
}

registerProcessor(playerProcessorName, PlayerProcessor);
