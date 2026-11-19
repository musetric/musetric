import { getRecordingLatencyCalibrationClickVerdict } from '@musetric/audio/es';
import {
  type microphoneCalibrationChannel,
  type RecordingLatencyCalibrationPeak,
  type RecordingLatencyCalibrationStart,
} from './protocol.cross.js';

const onsetRatio = 0.5;
const bandQuality = 3;
const levelPeriodSeconds = 0.01;
const quietWarmUpSeconds = 0.02;
const quietTimeSeconds = 0.3;
const quietGateRatio = 4;
const fadedRatio = 0.25;
const fadeLimitSeconds = 0.1;

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

const createQuietLevel = (sampleRate: number) => {
  const warmUpFrameCount = Math.round(quietWarmUpSeconds * sampleRate);
  const step = 1 / (quietTimeSeconds * sampleRate);
  let frameCount = 0;
  let value = 0;
  return {
    add: (level: number) => {
      if (frameCount < warmUpFrameCount) {
        frameCount += 1;
        value += (level - value) / frameCount;
        return;
      }
      if (level < value * quietGateRatio) {
        value += (level - value) * step;
      }
    },
    get: () => value,
  };
};

const getMeanLevel = (levels: Float32Array, length = levels.length) => {
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += levels[index];
  }
  return length > 0 ? sum / length : 0;
};

type ClickWindow = {
  clickFrame: number;
  levels: Float32Array;
  levelSum: number;
  peakOffset: number;
  peakValue: number;
  blockPeakValue: number;
  judgedPeakOffset: number;
  heard: boolean;
};

const getOnsetOffset = (click: ClickWindow) => {
  const threshold = click.peakValue * onsetRatio;
  for (let offset = 0; offset < click.peakOffset; offset += 1) {
    if (click.levels[offset] >= threshold) {
      return offset;
    }
  }
  return click.peakOffset;
};

const toPeak = (click: ClickWindow): RecordingLatencyCalibrationPeak => ({
  clickFrame: click.clickFrame,
  onsetFrame: click.clickFrame + getOnsetOffset(click),
  peakValue: click.peakValue,
  noiseValue: getMeanLevel(click.levels),
});

const toHeardPeak = (
  click: ClickWindow,
  filledFrameCount: number,
): RecordingLatencyCalibrationPeak | undefined => {
  const onsetOffset = getOnsetOffset(click);
  if (onsetOffset === 0) {
    return undefined;
  }
  const leadLevel = getMeanLevel(click.levels, onsetOffset);
  const risesFromQuiet =
    getRecordingLatencyCalibrationClickVerdict({
      clickFrame: click.clickFrame,
      onsetFrame: click.clickFrame + onsetOffset,
      peakValue: click.peakValue,
      noiseValue: leadLevel,
    }) !== 'missed';
  if (!risesFromQuiet) {
    return undefined;
  }
  const restFrameCount = click.levels.length - filledFrameCount;
  return {
    clickFrame: click.clickFrame,
    onsetFrame: click.clickFrame + onsetOffset,
    peakValue: click.peakValue,
    noiseValue:
      (click.levelSum + leadLevel * restFrameCount) / click.levels.length,
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
  let closedCount = 0;
  let collecting = false;
  let endFrame = 0;
  let windows: ClickWindow[] = [];
  let bandPass = (value: number) => value;
  let quiet = createQuietLevel(1);
  let levelPeriodFrameCount = 1;
  let fadeLimitFrameCount = 1;
  let levelFrameCount = 0;
  let levelPeak = 0;

  const getSearchEndFrame = (index: number) =>
    index + 1 >= clickFrames.length ? endFrame : clickFrames[index + 1];

  const closeUpTo = (count: number) => {
    while (closedCount < count) {
      port.methods.closed({
        clickIndex: closedCount,
        peak: toPeak(windows[closedCount]),
      });
      closedCount += 1;
    }
  };

  const finish = () => {
    collecting = false;
    closeUpTo(windows.length);
    port.methods.done({ peaks: windows.map(toPeak) });
  };

  const advanceClickIndex = (frame: number) => {
    while (clickIndex < clickFrames.length) {
      if (frame < getSearchEndFrame(clickIndex)) {
        return;
      }
      clickIndex += 1;
      closeUpTo(clickIndex);
    }
  };

  const sendLevel = (frame: number, value: number) => {
    levelPeak = Math.max(levelPeak, value);
    levelFrameCount += 1;
    if (levelFrameCount < levelPeriodFrameCount) {
      return;
    }
    const started = windows.length > 0 && frame >= windows[0].clickFrame;
    port.methods.level({
      clickIndex: started ? clickIndex : -1,
      level: levelPeak,
      quiet: quiet.get(),
    });
    levelFrameCount = 0;
    levelPeak = 0;
  };

  const listen = (click: ClickWindow, filledFrameCount: number) => {
    const { blockPeakValue } = click;
    click.blockPeakValue = 0;
    if (click.heard || click.peakOffset === click.judgedPeakOffset) {
      return;
    }
    const faded =
      blockPeakValue <= click.peakValue * fadedRatio ||
      filledFrameCount - click.peakOffset >= fadeLimitFrameCount;
    if (!faded) {
      return;
    }
    click.judgedPeakOffset = click.peakOffset;
    const peak = toHeardPeak(click, filledFrameCount);
    if (
      !peak ||
      getRecordingLatencyCalibrationClickVerdict(peak) === 'missed'
    ) {
      return;
    }
    click.heard = true;
    port.methods.heard({ clickIndex, peak });
  };

  const processInput = (input: Float32Array, currentFrame: number) => {
    for (let index = 0; index < input.length; index += 1) {
      const frame = currentFrame + index;
      const value = Math.abs(bandPass(input[index]));
      quiet.add(value);
      sendLevel(frame, value);
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
      click.levelSum += value;
      click.blockPeakValue = Math.max(click.blockPeakValue, value);
      if (value > click.peakValue) {
        click.peakOffset = offset;
        click.peakValue = value;
      }
    }

    const click = windows[clickIndex];
    const lastFrame = currentFrame + input.length - 1;
    if (lastFrame >= click.clickFrame) {
      listen(click, lastFrame - click.clickFrame + 1);
    }

    if (currentFrame + input.length >= endFrame) {
      finish();
    }
  };

  return {
    handleStart: (message) => {
      clickFrames = message.clickFrames;
      clickIndex = 0;
      closedCount = 0;
      endFrame = message.endFrame;
      bandPass = createBandPass(message.clickFrequency, message.sampleRate);
      quiet = createQuietLevel(message.sampleRate);
      levelPeriodFrameCount = Math.round(
        levelPeriodSeconds * message.sampleRate,
      );
      fadeLimitFrameCount = Math.round(fadeLimitSeconds * message.sampleRate);
      levelFrameCount = 0;
      levelPeak = 0;
      windows = message.clickFrames.map((clickFrame, index) => ({
        clickFrame,
        levels: new Float32Array(
          Math.max(0, getSearchEndFrame(index) - clickFrame),
        ),
        levelSum: 0,
        peakOffset: 0,
        peakValue: 0,
        blockPeakValue: 0,
        judgedPeakOffset: -1,
        heard: false,
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
