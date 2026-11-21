/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import { fillMonoOutput } from './monoOutput.worklet.js';
import { createNativeMicrophoneRuntime } from './nativeMicrophoneRuntime.worklet.js';
import {
  nativeMicrophoneChannel,
  nativeMicrophoneProcessorName,
} from './protocol.cross.js';
import { loadCapture } from './sampleRing.cross.js';

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
          runtime.push(chunk);
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
    fillMonoOutput(outputs, this.handleProcess);
    return true;
  }
}

registerProcessor(nativeMicrophoneProcessorName, NativeMicrophoneProcessor);
