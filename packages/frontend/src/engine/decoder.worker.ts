import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { decoderChannel } from '@musetric/audio/decoder';
import { createDecoderRuntime } from '@musetric/audio/decoder/worker';
import { playerDataChannel } from '@musetric/audio/player';
import { spectrogramDataChannel } from '@musetric/audio/spectrogram';
import axios from 'axios';

const port = decoderChannel.inbound(self);

const reportError = () => {
  port.methods.setState({
    status: 'error',
  });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot((message) => {
  createDecoderRuntime({
    port,
    playerPort: playerDataChannel.outbound(message.playerPort),
    spectrogramPort: spectrogramDataChannel.outbound(message.spectrogramPort),
    getEncodedBuffer: async (projectId, stemType) => {
      const encodedBuffer = await requestWithAxios(
        axios,
        api.audio.deliveryContent.base,
        {
          params: {
            projectId,
            stemType,
          },
        },
      );
      return encodedBuffer.buffer;
    },
  });
  port.methods.booted();
});
