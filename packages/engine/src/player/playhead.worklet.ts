import { playheadChannel, type PlayheadValue } from './playhead.cross.js';
import { sameLoop, wrapLoop } from './playheadPresenter.cross.js';

const pulseSeconds = 1 / 15;
const lineToleranceFrames = 128;
const rateTolerance = 0.02;

const onLine = (published: PlayheadValue, value: PlayheadValue) => {
  if (
    value.revision !== published.revision ||
    Math.abs(value.rate - published.rate) > rateTolerance ||
    (value.rate === 0) !== (published.rate === 0) ||
    value.clockOffset !== published.clockOffset ||
    value.endFrame !== published.endFrame ||
    value.startContextFrame !== published.startContextFrame ||
    !sameLoop(value.loop, published.loop)
  ) {
    return false;
  }
  const predicted = wrapLoop(
    published.frameIndex +
      (value.contextFrame - published.contextFrame) * published.rate,
    published.loop,
  );
  return Math.abs(predicted - value.frameIndex) <= lineToleranceFrames;
};

export type PlayheadPublisher = {
  publish: (value: PlayheadValue) => void;
  publishNow: (value: PlayheadValue) => void;
};

export const createPlayheadPublisher = (
  ports: MessagePort[],
  getCurrentTime: () => number,
): PlayheadPublisher => {
  const subscribers = ports.map(playheadChannel.outbound);
  let published: PlayheadValue | undefined = undefined;
  let publishedTime = 0;

  const publishNow = (value: PlayheadValue) => {
    published = value;
    publishedTime = getCurrentTime();
    for (const subscriber of subscribers) {
      subscriber.methods.publish(value);
    }
  };

  return {
    publish: (value) => {
      if (
        published &&
        onLine(published, value) &&
        (value.rate === 0 || getCurrentTime() - publishedTime < pulseSeconds)
      ) {
        return;
      }
      publishNow(value);
    },
    publishNow,
  };
};
