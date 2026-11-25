import { createSyncMessageChannel } from '@musetric/utils/cross/messageChannel';
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

export type RecordingStreamOutboundMethods = {
  returnChunk: (message: { samples: Float32Array<ArrayBuffer> }) => void;
};

export const recordingStreamChannel = createSyncMessageChannel<
  RecordingStreamInboundMethods,
  RecordingStreamOutboundMethods
>({
  inbound: {
    keys: ['chunk', 'flush'],
    transfers: {
      chunk: (message) => [message.samples.buffer],
    },
  },
  outbound: {
    keys: ['returnChunk'],
    transfers: {
      returnChunk: (message) => [message.samples.buffer],
    },
  },
});
