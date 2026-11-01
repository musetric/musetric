const zoomKeys = new Set(['+', '=', '-', '_', '0']);
const safariGestures = ['gesturestart', 'gesturechange', 'gestureend'];

export const blockPageZoom = (): void => {
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && zoomKeys.has(event.key)) {
      event.preventDefault();
    }
  });
  for (const type of safariGestures) {
    document.addEventListener(type, (event) => {
      event.preventDefault();
    });
  }
};
