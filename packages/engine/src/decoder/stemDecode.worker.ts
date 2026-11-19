import { createAudioDecoder } from '@musetric/audio/decoder';
import { stemDecodeChannel } from './stemDecode.cross.js';

const port = stemDecodeChannel.inbound(self);
const decoder = createAudioDecoder();

port.bindHandlers({
  decode: async (message) => {
    const { buffer, options } = message;
    try {
      port.methods.decoded(await decoder.decode(buffer, options));
    } catch (error) {
      port.methods.failed({
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
