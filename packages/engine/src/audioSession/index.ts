import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { createAndroidAudioSession, readAndroidMicrophone } from './android.js';
import { type EngineAudioSession } from './engineAudioSession.js';
import {
  createNativeAudioSession,
  readNativeMicrophoneHandler,
} from './native.js';
import { type CapturedChunkListener } from './timedMicrophone.js';
import { createWebAudioSession } from './web.js';

export const createEngineAudioSession = (
  context: AudioContext,
  outputClock: EngineOutputClock,
  onCaptured: CapturedChunkListener,
): EngineAudioSession => {
  const android = readAndroidMicrophone();
  if (android) {
    return createAndroidAudioSession(context, outputClock, android, onCaptured);
  }
  const handler = readNativeMicrophoneHandler();
  return handler
    ? createNativeAudioSession(context, handler)
    : createWebAudioSession(context, outputClock, onCaptured);
};
