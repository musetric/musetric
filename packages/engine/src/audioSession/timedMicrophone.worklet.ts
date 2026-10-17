/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  timedMicrophoneChannel,
  timedMicrophoneProcessorName,
} from './protocol.cross.js';
import {
  createTimedMicrophoneRuntime,
  type TimedMicrophoneRuntime,
} from './timedMicrophoneRuntime.worklet.js';

export class TimedMicrophoneProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  runtime: TimedMicrophoneRuntime;

  constructor() {
    super();
    const port = timedMicrophoneChannel.inbound(this.port);
    this.runtime = createTimedMicrophoneRuntime(sampleRate, () => {
      port.methods.ready();
    });
    port.bindHandlers({
      push: (message) => {
        this.runtime.push(message);
      },
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [output] = outputs;
    const [channel] = output;
    this.runtime.process(channel, currentFrame);
    for (let index = 1; index < output.length; index += 1) {
      output[index].set(channel);
    }
    return true;
  }
}

registerProcessor(timedMicrophoneProcessorName, TimedMicrophoneProcessor);
