import { type EnginePlayback } from './playback.js';

const noop = (): void => undefined;

export const createEngineStubPlayback = (): EnginePlayback => ({
  boot: async () => Promise.resolve(false),
  play: async () => Promise.resolve(false),
  stop: async () => Promise.resolve(0),
  setFrozen: noop,
  seek: noop,
  connectRecordingSource: () => noop,
  startRecording: noop,
  flushRecording: async () => Promise.resolve(0),
  sendTempoRatio: noop,
  sendTranspose: noop,
  sendVoice: noop,
  sendMetronome: noop,
  sendTrackVolume: noop,
  sendTrackVolumes: noop,
});
