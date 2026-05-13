import {
  type RecordingLatencyCalibrationDoneMessage,
  type RecordingLatencyCalibrationPeak,
  type RecordingLatencyCalibrationStartMessage,
} from '../protocol.cross.js';
export { microphoneCalibrationProcessorName } from '../protocol.cross.js';

export type MicrophoneCalibrationRuntime = {
  handleMessage: (message: unknown) => void;
  process: (
    inputs: (Float32Array[] | undefined)[],
    outputs: Float32Array[][],
    currentFrame: number,
  ) => void;
};

export type CreateMicrophoneCalibrationRuntimeOptions = {
  postMessage: (message: RecordingLatencyCalibrationDoneMessage) => void;
};

const isStartMessage = (
  message: unknown,
): message is RecordingLatencyCalibrationStartMessage => {
  if (typeof message !== 'object' || !message) {
    return false;
  }

  return (
    'type' in message &&
    message.type === 'start' &&
    'clickFrames' in message &&
    Array.isArray(message.clickFrames) &&
    'endFrame' in message &&
    typeof message.endFrame === 'number'
  );
};

export const createMicrophoneCalibrationRuntime = (
  options: CreateMicrophoneCalibrationRuntimeOptions,
): MicrophoneCalibrationRuntime => {
  const { postMessage } = options;
  let clickFrames: number[] = [];
  let clickIndex = 0;
  let collecting = false;
  let endFrame = 0;
  let peaks: RecordingLatencyCalibrationPeak[] = [];

  const finish = () => {
    collecting = false;
    postMessage({
      type: 'done',
      peaks,
    });
  };

  const advanceClickIndex = (frame: number) => {
    while (clickIndex < clickFrames.length) {
      const searchEndFrame =
        clickIndex + 1 >= clickFrames.length
          ? endFrame
          : clickFrames[clickIndex + 1];
      if (frame < searchEndFrame) {
        return;
      }

      clickIndex += 1;
    }
  };

  const processInput = (input: Float32Array, currentFrame: number) => {
    for (let index = 0; index < input.length; index += 1) {
      const frame = currentFrame + index;
      advanceClickIndex(frame);
      if (clickIndex >= peaks.length) {
        finish();
        return;
      }

      const peak = peaks[clickIndex];
      if (frame < peak.clickFrame) {
        continue;
      }

      if (frame >= endFrame) {
        finish();
        return;
      }

      const value = Math.abs(input[index]);
      if (value > peak.peakValue) {
        peak.peakFrame = frame;
        peak.peakValue = value;
      }
    }

    if (currentFrame + input.length >= endFrame) {
      finish();
    }
  };

  return {
    handleMessage: (message) => {
      if (!isStartMessage(message)) {
        return;
      }

      clickFrames = message.clickFrames;
      clickIndex = 0;
      endFrame = message.endFrame;
      peaks = message.clickFrames.map((clickFrame) => ({
        clickFrame,
        peakFrame: clickFrame,
        peakValue: 0,
      }));
      collecting = true;
    },
    process: (inputs, outputs, currentFrame) => {
      for (const output of outputs[0]) {
        output.fill(0);
      }

      if (!collecting) {
        return;
      }

      const [input] = inputs;
      const firstChannel = input?.[0];
      if (!firstChannel) {
        if (currentFrame >= endFrame) {
          finish();
        }
        return;
      }

      processInput(firstChannel, currentFrame);
    },
  };
};
