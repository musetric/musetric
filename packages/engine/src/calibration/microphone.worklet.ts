/* eslint-disable musetric/no-classes, musetric/no-this-expression */
import {
  createMicrophoneCalibrationRuntime,
  type MicrophoneCalibrationRuntime,
} from './microphoneRuntime.worklet.js';
import {
  microphoneCalibrationChannel,
  microphoneCalibrationProcessorName,
} from './protocol.cross.js';

export class MicrophoneCalibrationProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  runtime: MicrophoneCalibrationRuntime;

  constructor() {
    super();
    const port = microphoneCalibrationChannel.inbound(this.port);
    this.runtime = createMicrophoneCalibrationRuntime({
      port,
    });
    port.bindHandlers({
      start: (message) => {
        this.runtime.handleStart(message);
      },
    });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.runtime.process(inputs, outputs, currentFrame);
    return true;
  }
}

registerProcessor(
  microphoneCalibrationProcessorName,
  MicrophoneCalibrationProcessor,
);
