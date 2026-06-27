import { stemTypes } from '@musetric/audio/es';
import { waveformChannel } from './protocol.cross.js';
import { createWaveformRuntime } from './runtime.worker.js';

const port = waveformChannel.inbound(self);

const reportError = () => {
  for (const stemType of stemTypes) {
    port.methods.setDeliveryState({
      stemType,
      status: 'error',
    });
  }
  port.methods.setRecordingState({
    status: 'error',
  });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot(() => {
  createWaveformRuntime({
    port,
  });
  port.methods.booted();
});
