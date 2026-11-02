import { engine } from '../../../engine/engine.js';
import {
  type MediaAction,
  type MediaBridge,
  mediaEventName,
} from './mediaBridge.js';
import { createWebMediaBridge } from './webMediaBridge.js';

type NativeMediaBridge = {
  update: (state: string) => void;
  clear: () => void;
};

declare const MusetricMedia: NativeMediaBridge | undefined;

const driftMilliseconds = 500;

export const getMediaBridge = (): MediaBridge | undefined => {
  if (typeof MusetricMedia !== 'undefined') {
    const native = MusetricMedia;
    return {
      update: (state) => {
        native.update(JSON.stringify(state));
      },
      clear: () => {
        native.clear();
      },
    };
  }
  return 'mediaSession' in navigator
    ? createWebMediaBridge(navigator.mediaSession)
    : undefined;
};

const isMediaAction = (detail: unknown): detail is MediaAction =>
  detail instanceof Object && 'action' in detail;

type PublishedPosition = {
  positionMs: number;
  at: number;
  speed: number;
};

export const subscribeMediaSession = (
  bridge: MediaBridge,
  title: string,
  coverUrl: string | undefined,
): (() => void) => {
  const { sampleRate } = engine.context;
  const toMilliseconds = (frame: number) =>
    Math.round((frame / sampleRate) * 1000);
  let shown = false;
  let published: PublishedPosition | undefined = undefined;

  const publish = () => {
    const state = engine.store.get();
    if (!state.frameCount || (!shown && !state.playing)) {
      return;
    }
    shown = true;
    const positionMs = toMilliseconds(state.frameIndex);
    published = {
      positionMs,
      at: performance.now(),
      speed: state.playing ? state.tempoRatio : 0,
    };
    bridge.update({
      title,
      coverUrl,
      durationMs: toMilliseconds(state.frameCount),
      positionMs,
      playing: state.playing,
      recording: state.recording,
      speed: state.tempoRatio,
    });
  };

  const follow = () => {
    if (!published) {
      return;
    }
    const expected =
      published.positionMs +
      (performance.now() - published.at) * published.speed;
    const actual = toMilliseconds(engine.store.get().frameIndex);
    if (Math.abs(actual - expected) > driftMilliseconds) {
      publish();
    }
  };

  const handleAction = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isMediaAction(event.detail)) {
      return;
    }
    const { action, positionMs } = event.detail;
    if (action === 'play') {
      void engine.player.play();
      return;
    }
    if (action === 'pause') {
      void engine.player.stop();
      return;
    }
    if (positionMs !== undefined) {
      engine.player.seek(
        Math.round((positionMs / 1000) * sampleRate),
        'player',
      );
    }
  };

  const clear = () => {
    bridge.clear();
  };

  window.addEventListener(mediaEventName, handleAction);
  window.addEventListener('pagehide', clear);
  const unsubscribes = [
    engine.store.subscribe((state) => state.playing, publish),
    engine.store.subscribe((state) => state.recording, publish),
    engine.store.subscribe((state) => state.tempoRatio, publish),
    engine.store.subscribe((state) => state.seekEvent, publish),
    engine.store.subscribe((state) => state.frameIndex, follow),
  ];

  return () => {
    window.removeEventListener(mediaEventName, handleAction);
    window.removeEventListener('pagehide', clear);
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
    clear();
  };
};
