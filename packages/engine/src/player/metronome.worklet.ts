const regularFrequency = 880;
const accentFrequency = 1320;
const clickDurationSeconds = 0.05;
const envelopeTauSeconds = 0.015;

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

export type MetronomeProcessParams = {
  oldFrameIndex: number;
  newFrameIndex: number;
  outputs: Float32Array[];
  outputFrameCount: number;
};

export type Metronome = {
  setConfig: (
    message: MetronomeConfigMessage,
    currentFrameIndex: number,
  ) => void;
  reset: (currentFrameIndex: number) => void;
  clear: () => void;
  process: (params: MetronomeProcessParams) => void;
};

export const createMetronome = (sampleRate: number): Metronome => {
  let enabled = false;
  let volume = 0;
  let beatsInSamples: Int32Array | undefined = undefined;
  let downbeatMask: Uint8Array | undefined = undefined;
  let nextBeatIndex = 0;
  const activeTicks: MetronomeTick[] = [];
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
    activeTicks.length = 0;
  };

  const triggerBeats = (
    oldFrameIndex: number,
    newFrameIndex: number,
    outputFrameCount: number,
  ): void => {
    if (beatsInSamples === undefined) {
      return;
    }
    const advancedFrameCount = newFrameIndex - oldFrameIndex;
    if (advancedFrameCount <= 0) {
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
      const startOffset = Math.min(
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
      activeTicks.push({
        startOffset,
        elapsedSamples: 0,
        remainingSamples: clickDurationSamples,
        frequency: accent ? accentFrequency : regularFrequency,
        baseGain: volume,
      });
      nextBeatIndex += 1;
    }
  };

  const renderTicks = (
    outputs: Float32Array[],
    outputFrameCount: number,
  ): void => {
    if (activeTicks.length === 0) {
      return;
    }
    for (
      let tickIndex = activeTicks.length - 1;
      tickIndex >= 0;
      tickIndex -= 1
    ) {
      const tick = activeTicks[tickIndex];
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
        activeTicks.splice(tickIndex, 1);
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
    process: (params) => {
      const { oldFrameIndex, newFrameIndex, outputs, outputFrameCount } =
        params;
      if (enabled) {
        triggerBeats(oldFrameIndex, newFrameIndex, outputFrameCount);
      }
      renderTicks(outputs, outputFrameCount);
    },
  };
};
