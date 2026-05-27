export const waitNextFrame = async () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
