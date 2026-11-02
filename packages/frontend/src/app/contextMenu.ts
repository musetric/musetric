const fieldSelector = 'input, textarea';

export const blockContextMenu = (): void => {
  if (import.meta.env.DEV) {
    return;
  }
  document.addEventListener('contextmenu', (event) => {
    const { target } = event;
    if (!(target instanceof Element && target.closest(fieldSelector))) {
      event.preventDefault();
    }
  });
};
