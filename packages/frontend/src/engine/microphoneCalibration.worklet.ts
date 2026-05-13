/* eslint-disable no-restricted-syntax */
import {
  createMicrophoneCalibrationRuntime,
  microphoneCalibrationProcessorName,
  type MicrophoneCalibrationRuntime,
} from '@musetric/audio/recording/worklet';

export class MicrophoneCalibrationProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl
{
  runtime: MicrophoneCalibrationRuntime;

  constructor() {
    super();
    this.runtime = createMicrophoneCalibrationRuntime({
      postMessage: (message) => {
        this.port.postMessage(message);
      },
    });
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      this.runtime.handleMessage(event.data);
    };
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
