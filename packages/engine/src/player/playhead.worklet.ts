import { type PlayheadValue, sameLoop, wrapLoop } from '@musetric/transport';
import { playheadChannel } from './playhead.cross.js';

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
  getCurrentFrame: () => number,
  sampleRate: number,
): PlayheadPublisher => {
  const subscribers = ports.map(playheadChannel.outbound);
  const pulseFrameCount = sampleRate * pulseSeconds;
  let published: PlayheadValue | undefined = undefined;
  let publishedFrame = 0;

  const publishNow = (value: PlayheadValue) => {
    const copy = { ...value };
    published = copy;
    publishedFrame = getCurrentFrame();
    for (let index = 0; index < subscribers.length; index += 1) {
      subscribers[index].methods.publish(copy);
    }
  };

  return {
    publish: (value) => {
      if (
        published &&
        onLine(published, value) &&
        (value.rate === 0 ||
          getCurrentFrame() - publishedFrame < pulseFrameCount)
      ) {
        return;
      }
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- the playhead's 15 Hz pulse, or a change of its line
      publishNow(value);
    },
    publishNow,
  };
};
