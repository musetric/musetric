import { type EnginePlayback } from './playback.js';
import { type EnginePosition } from './position.js';

const noop = (): void => undefined;

export const createEngineStubPlayback = (
  position: EnginePosition,
): EnginePlayback => ({
  boot: async () => Promise.resolve(false),
  play: async () => Promise.resolve(false),
  stop: async () => Promise.resolve(0),
  readHeardFrame: () => position.read(),
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
