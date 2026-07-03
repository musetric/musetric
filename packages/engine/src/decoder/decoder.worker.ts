import { playerDataChannel } from '../player/protocol.cross.js';
import { spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { engineDecoderChannel } from './protocol.cross.js';
import { createDecoderWorkerRuntime } from './runtime.worker.js';

const port = engineDecoderChannel.inbound(self);

const reportError = () => {
  port.methods.setState({ status: 'error' });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot((message) => {
  createDecoderWorkerRuntime({
    port,
    playerPort: playerDataChannel.outbound(message.playerPort),
    spectrogramPort: spectrogramDataChannel.outbound(message.spectrogramPort),
    playhead: message.playhead,
  });
  port.methods.booted();
});
