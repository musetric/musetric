/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import { createNativeMicrophoneRuntime } from './nativeMicrophoneRuntime.worklet.js';
import {
  nativeMicrophoneChannel,
  nativeMicrophoneProcessorName,
} from './protocol.cross.js';
import { loadCapture } from './sampleRing.worklet.js';

export class NativeMicrophoneProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  constructor() {
    super();
    const port = nativeMicrophoneChannel.inbound(this.port);
    port.bindBoot((message) => {
      const runtime = createNativeMicrophoneRuntime(
        loadCapture(message.captureModule),
        sampleRate,
        () => {
          port.methods.ready();
        },
      );
      port.bindHandlers({
        push: (chunk) => {
          runtime.push(chunk.frame, chunk.samples);
        },
        reset: () => {
          runtime.reset();
        },
      });
      this.handleProcess = (channel) => {
        runtime.process(channel);
      };
    });
  }

  handleProcess = (channel: Float32Array) => {
    channel.fill(0);
  };

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [output] = outputs;
    const [channel] = output;
    this.handleProcess(channel);
    for (let index = 1; index < output.length; index += 1) {
      output[index].set(channel);
    }
    return true;
  }
}

registerProcessor(nativeMicrophoneProcessorName, NativeMicrophoneProcessor);
