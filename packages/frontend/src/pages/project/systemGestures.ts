const surfaces = new Set<HTMLElement>();

type GestureBridge = {
  exclude: (rects: string) => void;
};

const publish = (bridge: GestureBridge) => {
  bridge.exclude(
    JSON.stringify(
      [...surfaces].map((surface) => {
        const { left, top, right, bottom } = surface.getBoundingClientRect();
        return { left, top, right, bottom };
      }),
    ),
  );
};

type GestureWindow = Window & {
  MusetricGestures?: GestureBridge;
};

export const keepSystemGesturesOut = (surface: HTMLElement): (() => void) => {
  const target: GestureWindow = window;
  const bridge = target.MusetricGestures;
  if (!bridge) {
    return () => undefined;
  }
  surfaces.add(surface);
  const observer = new ResizeObserver(() => {
    publish(bridge);
  });
  observer.observe(document.documentElement);
  observer.observe(surface);
  return () => {
    observer.disconnect();
    surfaces.delete(surface);
    publish(bridge);
  };
};
