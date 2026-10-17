import {
  type microphoneCalibrationChannel,
  type RecordingLatencyCalibrationPeak,
} from './protocol.cross.js';

const onsetRatio = 0.5;

type ClickWindow = {
  clickFrame: number;
  levels: Float32Array;
  peakOffset: number;
  peakValue: number;
};

const toPeak = (click: ClickWindow): RecordingLatencyCalibrationPeak => {
  const threshold = click.peakValue * onsetRatio;
  let onsetOffset = click.peakOffset;
  for (let offset = 0; offset < click.peakOffset; offset += 1) {
    if (click.levels[offset] >= threshold) {
      onsetOffset = offset;
      break;
    }
  }
  return {
    clickFrame: click.clickFrame,
    onsetFrame: click.clickFrame + onsetOffset,
    peakValue: click.peakValue,
  };
};

export type MicrophoneCalibrationRuntime = {
  handleStart: (message: { clickFrames: number[]; endFrame: number }) => void;
  process: (
    inputs: (Float32Array[] | undefined)[],
    outputs: Float32Array[][],
    currentFrame: number,
  ) => void;
};

export type CreateMicrophoneCalibrationRuntimeOptions = {
  port: ReturnType<typeof microphoneCalibrationChannel.inbound<MessagePort>>;
};

export const createMicrophoneCalibrationRuntime = (
  options: CreateMicrophoneCalibrationRuntimeOptions,
): MicrophoneCalibrationRuntime => {
  const { port } = options;
  let clickFrames: number[] = [];
  let clickIndex = 0;
  let collecting = false;
  let endFrame = 0;
  let windows: ClickWindow[] = [];

  const getSearchEndFrame = (index: number) =>
    index + 1 >= clickFrames.length ? endFrame : clickFrames[index + 1];

  const finish = () => {
    collecting = false;
    port.methods.done({ peaks: windows.map(toPeak) });
  };

  const advanceClickIndex = (frame: number) => {
    while (clickIndex < clickFrames.length) {
      if (frame < getSearchEndFrame(clickIndex)) {
        return;
      }

      clickIndex += 1;
    }
  };

  const processInput = (input: Float32Array, currentFrame: number) => {
    for (let index = 0; index < input.length; index += 1) {
      const frame = currentFrame + index;
      advanceClickIndex(frame);
      if (clickIndex >= windows.length) {
        finish();
        return;
      }

      const click = windows[clickIndex];
      if (frame < click.clickFrame) {
        continue;
      }

      if (frame >= endFrame) {
        finish();
        return;
      }

      const offset = frame - click.clickFrame;
      const value = Math.abs(input[index]);
      click.levels[offset] = value;
      if (value > click.peakValue) {
        click.peakOffset = offset;
        click.peakValue = value;
      }
    }

    if (currentFrame + input.length >= endFrame) {
      finish();
    }
  };

  return {
    handleStart: (message) => {
      clickFrames = message.clickFrames;
      clickIndex = 0;
      endFrame = message.endFrame;
      windows = message.clickFrames.map((clickFrame, index) => ({
        clickFrame,
        levels: new Float32Array(
          Math.max(0, getSearchEndFrame(index) - clickFrame),
        ),
        peakOffset: 0,
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
