import {
  type microphoneCalibrationChannel,
  type RecordingLatencyCalibrationPeak,
  type RecordingLatencyCalibrationStart,
} from './protocol.cross.js';

const onsetRatio = 0.5;
const bandQuality = 3;

const createBandPass = (frequency: number, sampleRate: number) => {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * bandQuality);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x: number) => {
    const y = b0 * (x - x2) - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
};

const getMeanLevel = (levels: Float32Array) => {
  let sum = 0;
  for (const level of levels) {
    sum += level;
  }
  return levels.length > 0 ? sum / levels.length : 0;
};

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
    noiseValue: getMeanLevel(click.levels),
  };
};

export type MicrophoneCalibrationRuntime = {
  handleStart: (message: RecordingLatencyCalibrationStart) => void;
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
  let bandPass = (value: number) => value;

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
      port.methods.progress({ clickCount: clickIndex });
    }
  };

  const processInput = (input: Float32Array, currentFrame: number) => {
    for (let index = 0; index < input.length; index += 1) {
      const frame = currentFrame + index;
      const value = Math.abs(bandPass(input[index]));
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
      bandPass = createBandPass(message.clickFrequency, message.sampleRate);
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
