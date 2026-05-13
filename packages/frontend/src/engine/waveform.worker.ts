import { stemTypes } from '@musetric/audio/es';
import { waveformChannel } from '@musetric/audio/waveform';
import { createWaveformRuntime } from '@musetric/audio/waveform/worker';
import {
  getDeliveryAudioWave,
  getRecordingAudioWave,
} from './audioRequest.worker.js';

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
    getDeliveryWavePeaks: getDeliveryAudioWave,
    getRecordingWavePeaks: getRecordingAudioWave,
  });
  port.methods.booted();
});
