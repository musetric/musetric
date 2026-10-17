import { playheadChannel, type PlayheadValue } from './playhead.cross.js';

const publishIntervalSeconds = 1 / 240;

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
  let publishedTime = -publishIntervalSeconds;

  const publishNow = (value: PlayheadValue) => {
    published = value;
    publishedTime = getCurrentTime();
    for (const subscriber of subscribers) {
      subscriber.methods.publish(value);
    }
  };

  return {
    publish: (value) => {
      const unchanged =
        published !== undefined &&
        value.frameIndex === published.frameIndex &&
        value.revision === published.revision &&
        value.rate === published.rate &&
        value.clockOffset === published.clockOffset;
      if (unchanged) {
        return;
      }
      if (getCurrentTime() - publishedTime < publishIntervalSeconds) {
        return;
      }
      publishNow(value);
    },
    publishNow,
  };
};
