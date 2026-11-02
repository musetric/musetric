export const trackKeyboardInset = (): void => {
  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }

  const update = () => {
    const { style } = document.documentElement;
    const inset = window.innerHeight - viewport.height - viewport.offsetTop;
    style.setProperty('--keyboard-inset', `${Math.max(0, inset)}px`);
    style.setProperty('--visible-height', `${viewport.height}px`);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
};
