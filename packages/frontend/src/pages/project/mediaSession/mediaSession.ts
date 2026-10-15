import { engine } from '../../../engine/engine.js';

export type MediaBridge = {
  update: (state: string) => void;
  clear: () => void;
};

declare const MusetricMedia: MediaBridge | undefined;

const mediaEventName = 'musetric:media';
const driftMilliseconds = 500;

export const getMediaBridge = (): MediaBridge | undefined =>
  typeof MusetricMedia === 'undefined' ? undefined : MusetricMedia;

type MediaAction = {
  action: 'play' | 'pause' | 'seek';
  positionMs?: number;
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
    bridge.update(
      JSON.stringify({
        title,
        durationMs: toMilliseconds(state.frameCount),
        positionMs,
        playing: state.playing,
        speed: state.tempoRatio,
      }),
    );
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
