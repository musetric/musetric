import { type EngineAudioSession } from './engineAudioSession.js';
import {
  createNativeAudioSession,
  readNativeMicrophoneHandler,
} from './native.js';
import { createWebAudioSession } from './web.js';

export const createEngineAudioSession = (
  context: AudioContext,
): EngineAudioSession => {
  const handler = readNativeMicrophoneHandler();
  return handler
    ? createNativeAudioSession(context, handler)
    : createWebAudioSession(context);
};
