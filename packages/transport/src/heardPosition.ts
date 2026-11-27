import { type PlayheadValue } from './playhead.js';
import { type RangeFrames } from './rangeFrames.js';
import { createRenderHistory } from './renderHistory.js';

const renderHistoryCapacity = 1024;

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
  read: (
    value: PlayheadValue,
    revision: number,
    clockOffset: number | undefined,
    frameCount: number,
  ) => void;
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
  const heard = { contextFrame: 0, rate: 1 };
  let outputLatencyFrameCount = 0;

  const refresh = () => {
    heard.contextFrame = nextContextFrame - outputLatencyFrameCount;
    const entry = history.find(heard.contextFrame);
    if (entry < 0 || runStartContextFrame === undefined) {
      frameIndex = runStartFrameIndex;
      heard.contextFrame = runStartContextFrame ?? heard.contextFrame;
      const first = history.first();
      if (first >= 0) {
        heard.rate = history.rates[first];
      }
      return;
    }
    const songFrame = Math.round(
      history.frameIndices[entry] +
        (heard.contextFrame - history.contextFrames[entry]) *
          history.rates[entry],
    );
    const range = getRange();
    frameIndex = range ? range.songFrame(songFrame) : songFrame;
    heard.rate = history.rates[entry];
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
      history.push(contextFrame, renderFrameIndex, 0);
      refresh();
    },
    advance: (contextFrame, outputFrameCount, processedFrameCount) => {
      startQuantum(contextFrame, outputFrameCount);
      history.push(
        contextFrame,
        renderFrameIndex,
        processedFrameCount / outputFrameCount,
      );
      const nextFrameIndex = renderFrameIndex + processedFrameCount;
      const range = getRange();
      renderFrameIndex = range
        ? range.songFrame(nextFrameIndex)
        : nextFrameIndex;
      refresh();
      return nextFrameIndex;
    },
    refresh,
    read: (value, revision, clockOffset, frameCount) => {
      const range = getRange();
      value.frameIndex = frameIndex;
      value.revision = revision;
      value.contextFrame = heard.contextFrame;
      value.startContextFrame = runStartContextFrame ?? heard.contextFrame;
      value.rate = heard.rate;
      value.clockOffset = clockOffset;
      value.endFrame = range?.repeat === 'once' ? range.endFrame : frameCount;
      value.loop = range?.repeat === 'cycle' ? range.range : undefined;
    },
  };
};
