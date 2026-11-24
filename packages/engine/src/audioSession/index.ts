import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { createAndroidAudioSession, readAndroidMicrophone } from './android.js';
import { createDesktopAudioSession, hasDesktopMicrophone } from './desktop.js';
import { type EngineAudioSession } from './engineAudioSession.js';
import {
  createNativeAudioSession,
  readNativeMicrophoneHandler,
} from './native.js';
import { type CapturedChunkListener } from './timedMicrophone.js';
import { createWebAudioSession } from './web.js';

export const createEngineAudioSession = (
  getContext: () => AudioContext,
  outputClock: EngineOutputClock,
  onCaptured: CapturedChunkListener,
): EngineAudioSession => {
  const android = readAndroidMicrophone();
  if (android) {
    return createAndroidAudioSession(
      getContext,
      outputClock,
      android,
      onCaptured,
    );
  }
  const handler = readNativeMicrophoneHandler();
  if (handler) {
    return createNativeAudioSession(getContext, handler);
  }
  return hasDesktopMicrophone()
    ? createDesktopAudioSession(getContext, outputClock, onCaptured)
    : createWebAudioSession(getContext, outputClock, onCaptured);
};
