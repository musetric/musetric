import { type DecodedAudio, type DecodeOptions } from '@musetric/audio/decoder';
import { stemDecodeChannel } from './stemDecode.cross.js';
import stemDecodeWorkerUrl from './stemDecode.worker.ts?worker&url';

export type StemDecoders = {
  decode: (
    slot: number,
    buffer: ArrayBuffer,
    options: DecodeOptions,
  ) => Promise<DecodedAudio>;
};

export const createStemDecoders = (count: number): StemDecoders => {
  const slots = Array.from({ length: count }, () => ({
    port: stemDecodeChannel.outbound(
      new Worker(stemDecodeWorkerUrl, { type: 'module' }),
    ),
    queue: Promise.resolve(),
  }));

  return {
    decode: async (index, buffer, options) => {
      const slot = slots[index];
      const decoded = slot.queue.then(
        async () =>
          new Promise<DecodedAudio>((resolve, reject) => {
            slot.port.bindHandlers({
              decoded: resolve,
              failed: (message) => {
                reject(new Error(message.reason));
              },
            });
            slot.port.methods.decode({ buffer, options });
          }),
      );
      slot.queue = decoded.then(
        () => undefined,
        () => undefined,
      );
      return decoded;
    },
  };
};
