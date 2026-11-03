import { encodeMonoWav } from '@musetric/engine';
import { noop } from '@tanstack/react-query';
import {
  type MediaAction,
  type MediaBridge,
  mediaEventName,
  type MediaState,
} from './mediaBridge.js';

const artist = 'Musetric';
const defaultArtworkUrl = '/media-artwork.png';
const silenceSampleRate = 8000;
const positionToleranceSeconds = 0.25;

const createSilence = (durationMs: number): string => {
  const frameCount = Math.ceil((durationMs / 1000) * silenceSampleRate);
  const wav = encodeMonoWav(new Float32Array(frameCount), silenceSampleRate);
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
};

const sendAction = (detail: MediaAction) => {
  window.dispatchEvent(new CustomEvent(mediaEventName, { detail }));
};

export const createWebMediaBridge = (session: MediaSession): MediaBridge => {
  const silence = new Audio();
  let silenceUrl: string | undefined = undefined;

  const setHandlers = () => {
    session.setActionHandler('play', () => {
      sendAction({ action: 'play' });
    });
    session.setActionHandler('pause', () => {
      sendAction({ action: 'pause' });
    });
    session.setActionHandler('seekto', (details) => {
      sendAction({
        action: 'seek',
        positionMs: (details.seekTime ?? 0) * 1000,
      });
    });
  };

  const start = (state: MediaState) => {
    silenceUrl = createSilence(state.durationMs);
    silence.src = silenceUrl;
    session.metadata = new MediaMetadata({
      title: state.title,
      artist,
      artwork: [{ src: state.coverUrl ?? defaultArtworkUrl }],
    });
    setHandlers();
  };

  return {
    update: (state) => {
      if (!silenceUrl) {
        start(state);
      }
      const position = state.positionMs / 1000;
      if (Math.abs(silence.currentTime - position) > positionToleranceSeconds) {
        silence.currentTime = position;
      }
      silence.playbackRate = state.speed;
      session.playbackState = state.playing ? 'playing' : 'paused';
      if (state.playing && !state.recording) {
        silence.play().catch(noop);
      } else {
        silence.pause();
      }
    },
    clear: () => {
      silence.pause();
      silence.removeAttribute('src');
      silence.load();
      if (silenceUrl) {
        URL.revokeObjectURL(silenceUrl);
        silenceUrl = undefined;
      }
      // eslint-disable-next-line musetric/no-null-literal
      session.metadata = null;
      session.playbackState = 'none';
      for (const action of ['play', 'pause', 'seekto'] as const) {
        // eslint-disable-next-line musetric/no-null-literal
        session.setActionHandler(action, null);
      }
    },
  };
};
