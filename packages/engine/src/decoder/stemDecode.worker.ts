import { createAudioDecoder } from '@musetric/audio/decoder';
import { getMasterAudioStream } from '../audioRequest/audioRequest.worker.js';
import { stemDecodeChannel } from './stemDecode.cross.js';

const port = stemDecodeChannel.inbound(self);
const decoder = createAudioDecoder();

port.bindHandlers({
  decode: async (message) => {
    const { projectId, stem, sampleRate } = message;
    try {
      const stream = await getMasterAudioStream(projectId, stem);
      port.methods.decoded(
        await decoder.decodeFlacStream(stream, {
          sampleRate,
          keepAacDelay: true,
        }),
      );
    } catch (error) {
      port.methods.failed({
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
