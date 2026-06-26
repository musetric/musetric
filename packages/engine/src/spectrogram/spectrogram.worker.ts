import {
  spectrogramChannel,
  spectrogramDataChannel,
} from '@musetric/spectrogram';
import { createSpectrogramRuntime } from '@musetric/spectrogram/worker';

const profiling = import.meta.env.frontendSpectrogramProfiling === 'true';
const port = spectrogramChannel.inbound(self);

const reportError = () => {
  port.methods.setState({
    status: 'error',
  });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot(async (message) => {
  await createSpectrogramRuntime({
    port,
    dataPort: spectrogramDataChannel.inbound(message.dataPort),
    playhead: message.playhead,
    profiling,
  });
  port.methods.booted();
});
