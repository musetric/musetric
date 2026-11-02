const fieldSelector = 'input[type="text"], input[type="number"], textarea';

const isField = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(fieldSelector));

type TextInteractionWindow = Window & {
  webkit?: {
    messageHandlers?: {
      musetricTextInteraction?: { postMessage: (enabled: boolean) => void };
    };
  };
};

export const allowTextInteractionInFields = (): void => {
  const target: TextInteractionWindow = window;
  const handler = target.webkit?.messageHandlers?.musetricTextInteraction;
  if (!handler) {
    return;
  }
  document.addEventListener(
    'touchstart',
    (event) => {
      handler.postMessage(
        isField(event.target) || isField(document.activeElement),
      );
    },
    { capture: true, passive: true },
  );
};
