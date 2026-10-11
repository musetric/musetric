import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';
import { type LiveTakeChunk } from './protocol.cross.js';

export type RecordingStreamChunkMessage = LiveTakeChunk & {
  sequence: number;
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
    transfers: {
      chunk: (message) => [message.samples.buffer],
    },
  },
  outbound: {
    keys: [],
  },
});
