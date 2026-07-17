import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export type RecordingStreamChunkMessage = {
  sequence: number;
  frameIndex: number;
  bufferFrameIndex: number;
  bufferOffset: number;
  frameCount: number;
};

export type RecordingStreamFlushMessage = {
  sequence: number;
};

export type RecordingStreamInboundMethods = {
  chunk: (message: RecordingStreamChunkMessage) => void;
  flush: (message: RecordingStreamFlushMessage) => void;
};

export const recordingStreamChannel = createMessageChannel<
  RecordingStreamInboundMethods,
  EmptyPortMethods
>({
  inbound: {
    keys: ['chunk', 'flush'],
  },
  outbound: {
    keys: [],
  },
});
