export const subscribeResizeObserver = (
  element: Element,
  callback: () => void | Promise<void>,
) => {
  let isEntry = true;
  const observer = new ResizeObserver(async () => {
    if (isEntry) {
      isEntry = false;
      return;
    }
    await callback();
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};
