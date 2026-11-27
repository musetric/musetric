import { spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { engineProjectChannel } from './protocol.cross.js';
import { createProjectWorkerRuntime } from './runtime.worker.js';

const port = engineProjectChannel.inbound(self);

const reportError = () => {
  port.methods.setState({ status: 'error' });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot((message) => {
  createProjectWorkerRuntime({
    port,
    spectrogramPort: spectrogramDataChannel.outbound(message.spectrogramPort),
  });
  port.methods.booted();
});
