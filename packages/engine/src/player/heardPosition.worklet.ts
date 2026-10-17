import { type RangeFrames } from './playerRange.worklet.js';
import { type PlayheadValue } from './playhead.cross.js';
import { createRenderHistory } from './renderHistory.worklet.js';

const renderHistoryCapacity = 1024;

export type HeardPositionValueOptions = {
  revision: number;
  clockOffset: number | undefined;
  frameCount: number;
};

export type HeardPosition = {
  getFrameIndex: () => number;
  getRenderFrameIndex: () => number;
  getPendingOutputFrameCount: () => number;
  setOutputLatency: (outputLatencyFrameCount: number) => void;
  begin: (frameIndex: number) => void;
  hold: (contextFrame: number, outputFrameCount: number) => void;
  advance: (
    contextFrame: number,
    outputFrameCount: number,
    processedFrameCount: number,
  ) => number;
  refresh: () => void;
  getValue: (options: HeardPositionValueOptions) => PlayheadValue;
};

export const createHeardPosition = (
  getRange: () => RangeFrames | undefined,
): HeardPosition => {
  const history = createRenderHistory(renderHistoryCapacity);
  let frameIndex = 0;
  let renderFrameIndex = 0;
  let runStartFrameIndex = 0;
  let runStartContextFrame: number | undefined = undefined;
  let nextContextFrame = 0;
  let heardContextFrame = 0;
  let heardRate = 1;
  let outputLatencyFrameCount = 0;

  const refresh = () => {
    heardContextFrame = nextContextFrame - outputLatencyFrameCount;
    const entry = history.find(heardContextFrame);
    if (!entry || runStartContextFrame === undefined) {
      frameIndex = runStartFrameIndex;
      heardContextFrame = runStartContextFrame ?? heardContextFrame;
      heardRate = history.first()?.rate ?? heardRate;
      return;
    }
    const songFrame = Math.round(
      entry.frameIndex + (heardContextFrame - entry.contextFrame) * entry.rate,
    );
    const range = getRange();
    frameIndex = range ? range.songFrame(songFrame) : songFrame;
    heardRate = entry.rate;
  };

  const startQuantum = (contextFrame: number, outputFrameCount: number) => {
    nextContextFrame = contextFrame + outputFrameCount;
    runStartContextFrame ??= contextFrame;
  };

  return {
    getFrameIndex: () => frameIndex,
    getRenderFrameIndex: () => renderFrameIndex,
    getPendingOutputFrameCount: () =>
      Math.max(
        0,
        outputLatencyFrameCount -
          (runStartContextFrame === undefined
            ? 0
            : nextContextFrame - runStartContextFrame),
      ),
    setOutputLatency: (nextOutputLatencyFrameCount) => {
      outputLatencyFrameCount = nextOutputLatencyFrameCount;
    },
    begin: (nextFrameIndex) => {
      frameIndex = nextFrameIndex;
      renderFrameIndex = nextFrameIndex;
      runStartFrameIndex = nextFrameIndex;
      runStartContextFrame = undefined;
      history.clear();
    },
    hold: (contextFrame, outputFrameCount) => {
      startQuantum(contextFrame, outputFrameCount);
      history.push({ contextFrame, frameIndex: renderFrameIndex, rate: 0 });
      refresh();
    },
    advance: (contextFrame, outputFrameCount, processedFrameCount) => {
      startQuantum(contextFrame, outputFrameCount);
      history.push({
        contextFrame,
        frameIndex: renderFrameIndex,
        rate: processedFrameCount / outputFrameCount,
      });
      const nextFrameIndex = renderFrameIndex + processedFrameCount;
      const range = getRange();
      renderFrameIndex = range
        ? range.songFrame(nextFrameIndex)
        : nextFrameIndex;
      refresh();
      return nextFrameIndex;
    },
    refresh,
    getValue: (options) => {
      const range = getRange();
      return {
        frameIndex,
        revision: options.revision,
        contextFrame: heardContextFrame,
        startContextFrame: runStartContextFrame ?? heardContextFrame,
        rate: heardRate,
        clockOffset: options.clockOffset,
        endFrame:
          range?.repeat === 'once' ? range.endFrame : options.frameCount,
        loop: range?.repeat === 'cycle' ? range.range : undefined,
      };
    },
  };
};
