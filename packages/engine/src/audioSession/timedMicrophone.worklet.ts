/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  timedMicrophoneChannel,
  timedMicrophoneProcessorName,
} from './protocol.cross.js';
import { loadCapture } from './sampleRing.worklet.js';
import { createTimedMicrophoneRuntime } from './timedMicrophoneRuntime.worklet.js';

export class TimedMicrophoneProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  constructor() {
    super();
    const port = timedMicrophoneChannel.inbound(this.port);
    port.bindBoot((message) => {
      const runtime = createTimedMicrophoneRuntime(
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
      });
      this.handleProcess = (channel) => {
        runtime.process(channel, currentFrame);
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

registerProcessor(timedMicrophoneProcessorName, TimedMicrophoneProcessor);
