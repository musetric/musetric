import { type RangeFrames } from './playerRange.worklet.js';

const regularFrequency = 880;
const accentFrequency = 1320;
const clickDurationSeconds = 0.05;
const envelopeTauSeconds = 0.015;
const tickLimit = 16;

type MetronomeTick = {
  startOffset: number;
  elapsedSamples: number;
  remainingSamples: number;
  frequency: number;
  baseGain: number;
};

export type MetronomeConfigMessage = {
  beatsInSamples: Int32Array;
  downbeatMask: Uint8Array;
  enabled: boolean;
  volume: number;
};

export type Metronome = {
  setConfig: (
    message: MetronomeConfigMessage,
    currentFrameIndex: number,
  ) => void;
  reset: (currentFrameIndex: number) => void;
  clear: () => void;
  process: (
    oldFrameIndex: number,
    newFrameIndex: number,
    outputs: Float32Array[],
    range: RangeFrames | undefined,
  ) => void;
};

export const createMetronome = (sampleRate: number): Metronome => {
  let enabled = false;
  let volume = 0;
  let beatsInSamples: Int32Array | undefined = undefined;
  let downbeatMask: Uint8Array | undefined = undefined;
  let nextBeatIndex = 0;
  const ticks: MetronomeTick[] = Array.from({ length: tickLimit }, () => ({
    startOffset: 0,
    elapsedSamples: 0,
    remainingSamples: 0,
    frequency: 0,
    baseGain: 0,
  }));
  let tickCount = 0;
  const clickDurationSamples = Math.round(sampleRate * clickDurationSeconds);
  const envelopeTauSamples = Math.max(1, sampleRate * envelopeTauSeconds);

  const seekBeatCursor = (currentFrameIndex: number): void => {
    if (beatsInSamples === undefined || beatsInSamples.length === 0) {
      nextBeatIndex = 0;
      return;
    }
    let lo = 0;
    let hi = beatsInSamples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (beatsInSamples[mid] < currentFrameIndex) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    nextBeatIndex = lo;
  };

  const clearTicks = (): void => {
    tickCount = 0;
  };

  const removeTick = (index: number): void => {
    const removed = ticks[index];
    for (let next = index + 1; next < tickCount; next += 1) {
      ticks[next - 1] = ticks[next];
    }
    tickCount -= 1;
    ticks[tickCount] = removed;
  };

  const triggerBeats = (
    oldFrameIndex: number,
    newFrameIndex: number,
    outputStart: number,
    outputFrameCount: number,
  ): void => {
    if (beatsInSamples === undefined) {
      return;
    }
    const advancedFrameCount = newFrameIndex - oldFrameIndex;
    if (advancedFrameCount <= 0 || outputFrameCount <= 0) {
      return;
    }
    while (nextBeatIndex < beatsInSamples.length) {
      const beatFrame = beatsInSamples[nextBeatIndex];
      if (beatFrame >= newFrameIndex) {
        break;
      }
      if (beatFrame < oldFrameIndex) {
        nextBeatIndex += 1;
        continue;
      }
      const beatOffset = beatFrame - oldFrameIndex;
      const startOffset =
        outputStart +
        Math.min(
          outputFrameCount - 1,
          Math.max(
            0,
            Math.floor((beatOffset / advancedFrameCount) * outputFrameCount),
          ),
        );
      const accent =
        downbeatMask !== undefined &&
        nextBeatIndex < downbeatMask.length &&
        downbeatMask[nextBeatIndex] !== 0;
      if (tickCount === tickLimit) {
        removeTick(0);
      }
      const tick = ticks[tickCount];
      tick.startOffset = startOffset;
      tick.elapsedSamples = 0;
      tick.remainingSamples = clickDurationSamples;
      tick.frequency = accent ? accentFrequency : regularFrequency;
      tick.baseGain = volume;
      tickCount += 1;
      nextBeatIndex += 1;
    }
  };

  const renderTicks = (
    outputs: Float32Array[],
    outputFrameCount: number,
  ): void => {
    for (let tickIndex = tickCount - 1; tickIndex >= 0; tickIndex -= 1) {
      const tick = ticks[tickIndex];
      let s = tick.startOffset;
      while (s < outputFrameCount && tick.remainingSamples > 0) {
        const phase =
          (tick.elapsedSamples * tick.frequency * 2 * Math.PI) / sampleRate;
        const envelope = Math.exp(-tick.elapsedSamples / envelopeTauSamples);
        const sampleValue = Math.sin(phase) * tick.baseGain * envelope;
        for (
          let channelIndex = 0;
          channelIndex < outputs.length;
          channelIndex += 1
        ) {
          outputs[channelIndex][s] += sampleValue;
        }
        tick.elapsedSamples += 1;
        tick.remainingSamples -= 1;
        s += 1;
      }
      tick.startOffset = 0;
      if (tick.remainingSamples <= 0) {
        removeTick(tickIndex);
      }
    }
  };

  return {
    setConfig: (message, currentFrameIndex) => {
      enabled = message.enabled;
      volume = message.volume;
      beatsInSamples =
        message.beatsInSamples.length > 0 ? message.beatsInSamples : undefined;
      downbeatMask =
        message.downbeatMask.length > 0 ? message.downbeatMask : undefined;
      seekBeatCursor(currentFrameIndex);
    },
    reset: (currentFrameIndex) => {
      seekBeatCursor(currentFrameIndex);
    },
    clear: clearTicks,
    process: (oldFrameIndex, newFrameIndex, outputs, range) => {
      const outputFrameCount = outputs[0].length;
      if (!range) {
        if (enabled) {
          triggerBeats(oldFrameIndex, newFrameIndex, 0, outputFrameCount);
        }
        renderTicks(outputs, outputFrameCount);
        return;
      }
      const { fromFrame, toFrame } = range.range;
      const oldSongFrame = range.songFrame(oldFrameIndex);
      const newSongFrame = range.songFrame(newFrameIndex);
      const endFrame = Math.min(newSongFrame, toFrame);
      if (newSongFrame >= oldSongFrame) {
        if (enabled) {
          triggerBeats(oldSongFrame, endFrame, 0, outputFrameCount);
        }
        renderTicks(outputs, outputFrameCount);
        return;
      }
      const before = toFrame - oldSongFrame;
      const after = endFrame - fromFrame;
      const split = Math.round(
        (outputFrameCount * before) / Math.max(1, before + after),
      );
      if (enabled) {
        triggerBeats(oldSongFrame, toFrame, 0, split);
      }
      seekBeatCursor(fromFrame);
      if (enabled) {
        triggerBeats(fromFrame, endFrame, split, outputFrameCount - split);
      }
      renderTicks(outputs, outputFrameCount);
    },
  };
};
