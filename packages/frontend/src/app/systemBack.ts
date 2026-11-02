const backEventName = 'musetric:back';

const findTopOverlay = (): Element | undefined =>
  [...document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden)')].at(-1);

export const subscribeSystemBack = (
  listener: (event: Event) => void,
): (() => void) => {
  window.addEventListener(backEventName, listener);
  return () => {
    window.removeEventListener(backEventName, listener);
  };
};

export const closeOverlaysOnBack = (): void => {
  subscribeSystemBack((event) => {
    const overlay = findTopOverlay();
    if (!overlay) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    overlay.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
};
