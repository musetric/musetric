/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  createNativeMicrophoneRuntime,
  type NativeMicrophoneRuntime,
} from './nativeMicrophoneRuntime.worklet.js';
import {
  nativeMicrophoneChannel,
  nativeMicrophoneProcessorName,
} from './protocol.cross.js';

export class NativeMicrophoneProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  runtime: NativeMicrophoneRuntime;

  constructor() {
    super();
    const port = nativeMicrophoneChannel.inbound(this.port);
    this.runtime = createNativeMicrophoneRuntime(sampleRate, () => {
      port.methods.ready();
    });
    port.bindHandlers({
      push: (message) => {
        this.runtime.push(message.frame, message.samples);
      },
      reset: () => {
        this.runtime.reset();
      },
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [output] = outputs;
    const [channel] = output;
    this.runtime.process(channel);
    for (let index = 1; index < output.length; index += 1) {
      output[index].set(channel);
    }
    return true;
  }
}

registerProcessor(nativeMicrophoneProcessorName, NativeMicrophoneProcessor);
