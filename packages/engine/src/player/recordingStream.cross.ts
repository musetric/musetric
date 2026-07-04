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

export type RecordingStreamOutboundMethods = EmptyPortMethods;

export const recordingStreamChannel = createMessageChannel<
  RecordingStreamInboundMethods,
  RecordingStreamOutboundMethods
>({
  inbound: {
    keys: ['chunk', 'flush'],
  },
  outbound: {
    keys: [],
  },
});
