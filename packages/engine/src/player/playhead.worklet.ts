import { playheadChannel, type PlayheadValue } from './playhead.cross.js';

const publishIntervalSeconds = 1 / 240;

export type PlayheadPublisher = {
  publish: (value: PlayheadValue) => void;
  publishNow: (value: PlayheadValue) => void;
};

export const createPlayheadPublisher = (
  ports: MessagePort[],
): PlayheadPublisher => {
  const subscribers = ports.map(playheadChannel.outbound);
  let publishedFrameIndex = -1;
  let publishedRevision = -1;
  let publishedTime = -publishIntervalSeconds;

  const publishNow = (value: PlayheadValue) => {
    publishedFrameIndex = value.frameIndex;
    publishedRevision = value.revision;
    publishedTime = currentTime;
    for (const subscriber of subscribers) {
      subscriber.methods.publish(value);
    }
  };

  return {
    publish: (value) => {
      const unchanged =
        value.frameIndex === publishedFrameIndex &&
        value.revision === publishedRevision;
      if (unchanged) {
        return;
      }
      if (currentTime - publishedTime < publishIntervalSeconds) {
        return;
      }
      publishNow(value);
    },
    publishNow,
  };
};
