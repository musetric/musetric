import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export type PlayheadValue = {
  frameIndex: number;
  revision: number;
};

export type PlayheadMethods = {
  publish: (message: PlayheadValue) => void;
};

export const playheadChannel = createMessageChannel<
  EmptyPortMethods,
  PlayheadMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['publish'],
  },
});

export type Playhead = {
  read: () => PlayheadValue;
  writeFrameIndex: (frameIndex: number) => void;
};

export const createPlayhead = (port: MessagePort): Playhead => {
  let value: PlayheadValue = { frameIndex: 0, revision: 0 };
  playheadChannel.inbound(port).bindHandlers({
    publish: (message) => {
      value = message;
    },
  });

  return {
    read: () => value,
    writeFrameIndex: (frameIndex) => {
      value = { frameIndex, revision: value.revision };
    },
  };
};
